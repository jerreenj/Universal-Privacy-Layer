// SPDX-License-Identifier: MIT
module upl::privacy_relayer {
    /// Gas-only meta-tx forwarder for private transfers.
    ///
    /// Ported from `PrivacyRelayer.sol` (EVM) as a Sui Move module under
    /// `upl::privacy_relayer`. An off-chain relayer (holding `RelayerCap`) submits
    /// a user's signed intent and a `Coin<SUI>` to `relay`, which skims a basis-
    /// point fee into a withdrawable `accumulated_fees` Balance and forwards the
    /// net to a one-time stealth recipient. Non-custodial between transfers:
    /// only accrued fees + refundable prepaid tickets are ever retained.
    ///
    /// Semantic differences from the EVM original (`PrivacyRelayer.sol`):
    ///   - `onlyOwner` -> `AdminCap` capability resource held by the deployer.
    ///   - `relayer` (allowed address) -> `RelayerCap` capability resource
    ///     transferred to the configured relayer address. `relay` takes
    ///     `&RelayerCap` (compile-time capability check) instead of an
    ///     address==relayer runtime assertion. This is strictly safer than the
    ///     EVM `require(msg.sender == relayer)` runtime check.
    ///   - `payable`/`msg.value` -> `Coin<SUI>` resource passed as an entry
    ///     parameter and consumed via `coin::value`/`coin::split`/`coin::put`. No
    ///     implicit "ETH lands in contract" — the coin is explicitly moved.
    ///   - `nonReentrant` is **dropped**: Move entry functions are atomic and
    ///     there is no contract-call-back reentrancy on Sui (resource linear
    ///     typing + the programmable transaction model prevent the classic EVM
    ///     state-between-external-call reentrancy). Keeping it would be a no-op.
    ///   - `keccak256(abi.encodePacked(recipient))` (an unlinkable anchor the
    ///     recipient could later prove) -> Sui has no keccak256 in the standard
    ///     framework by default; we use `std::hash::sha3_256(sui::address::to_bytes(recipient))`
    ///     instead. Same purpose (a one-way recipient commitment that does NOT
    ///     reveal the recipient address to a casual observer of the event
    ///     stream), different digest.
    ///   - `block.timestamp` -> `Clock::timestamp_ms` (ms; EVM used seconds).
    ///   - `msg.sender` (the relayer identity / fee owner) is read via
    ///     `tx_context::sender(ctx)` from the entry's `&mut TxContext`.
    ///   - EVM `prepaidBalance[address] => uint256` mapping -> a transferable
    ///     `PrepaidTicket` resource that each depositor owns (lives in a separate
    ///     `upl::prepaid_ticket` module — see its docs for why this Sui-native
    ///     shape is strictly better than the EVM global mapping, and lets the
    ///     ticket be moved/sold/split independently of the relayer).
    ///   - `receive()` fallback (stray ETH recoverable only by owner) is
    ///     **dropped entirely**: Sui has no "coins accidentally land in a
    ///     module" path — every value moves as a typed Coin resource supplied
    ///     to an entry function.
    ///   - Checks-effects-interactions ordering (zero `accumulated_fees` before
    ///     external transfer in `withdraw_fees`) is **kept** even though Move
    ///     has no reentrancy, because it is a free safety belt and matches the
    ///     EVM contract's documented intent.
    ///
    /// The shared object of this module, `RelayerState`, holds the mutable
    /// configuration + the accrued fees Balance. The `AdminCap` and
    /// `RelayerCap` are minted in `init` and transferred to the publisher
    /// (AdminCap) and a configured relayer address (RelayerCap).

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::address;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::hash;
    use std::vector;

    /// Admin capability. The holder can: rotate the fee rate, withdraw accrued
    /// fees, and (indirectly) rotate the relayer (by transferring the
    /// `RelayerCap` themselves). Created once in `init`, transferred to the
    /// publisher. **Transferable** so the deployer can move it to a multisig.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Relayer capability. The holder is the only address that may call
    /// `relay` (the on-chain leg of a relayer-submitted intent). Created once
    /// in `init`, transferred to a configured relayer address. Transferable so
    /// the operator can fail-over to a new relayer without re-deploying.
    public struct RelayerCap has key, store {
        id: UID,
    }

    /// Shared, mutable relayer configuration + accrued-fee Balance. The
    /// "config" parts (`fee_bps`, `max_fee_bps`, `fee_denominator`) are guarded
    /// by `AdminCap`; everyone reads them. `accumulated_fees` is a single
    /// `Balance<SUI>` whose value only grows (relay) and is emptied by
    /// `withdraw_fees` under `AdminCap`.
    public struct RelayerState has key {
        id: UID,
        fee_bps: u64,
        /// Hard cap on `fee_bps` (1% == 100 bps). Matches `MAX_FEE_BPS` in the
        /// EVM contract; set once at `init`, write-once.
        max_fee_bps: u64,
        /// Fee denominator (10000). Matches `FEE_DENOMINATOR` in the EVM.
        fee_denominator: u64,
        /// Total SUI ever forwarded to stealth recipients (net of fees).
        /// Monotonic; matches `totalRelayed()` in the EVM.
        total_relayed: u64,
        /// Accrued protocol fees, withdrawable by the AdminCap holder.
        accumulated_fees: Balance<SUI>,
    }

    /// Event emitted on every successful `relay`. `stealth_address_hash` is the
    /// sha3_256 commitment to the recipient (not the recipient itself) so a
    /// casual observer of the event stream cannot link the recipient's address.
    public struct PrivateTransfer has copy, drop {
        stealth_address_hash: vector<u8>,
        ephemeral_key: vector<u8>,
        view_tag: u8,
        amount: u64,
        fee: u64,
        timestamp_ms: u64,
    }

    public struct FeeRateUpdated has copy, drop { old_rate: u64, new_rate: u64 }
    public struct FeesWithdrawn has copy, drop { to: address, amount: u64 }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EZeroAmount: u64 = 1;
    const EInvalidRecipient: u64 = 2;
    const EFeeBpsTooHigh: u64 = 3;
    const EWithdrawZero: u64 = 4;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints:
    ///   - the shared `RelayerState` (fee_bps default 0 → free relayer at
    ///     launch; the admin raises it via `set_fee_bps`. EVM default was 0 too.
    ///     Hard-capped at `MAX_FEE_BPS = 100` = 1% via `set_fee_bps`'s assert),
    ///   - one `AdminCap`, transferred to the publisher,
    ///   - one `RelayerCap`, transferred to a relayer address read from the
    ///     publish transaction's `sender`.
    ///
    /// Sui Move `init` does not accept extra parameters, so the relayer address
    /// is the publisher's own address by default — the AdminCap holder transfers
    /// the RelayerCap to the real relayer (off-chain or via a separate transfer
    /// tx) once deployment is complete. This matches how the EVM contract is
    /// configured in practice (deployer calls `setRelayer` post-deploy).
    fun init(ctx: &mut TxContext) {
        let admin = AdminCap { id: object::new(ctx) };
        let relayer = RelayerCap { id: object::new(ctx) };

        let state = RelayerState {
            id: object::new(ctx),
            fee_bps: 0,
            max_fee_bps: 100,
            fee_denominator: 10000,
            total_relayed: 0,
            accumulated_fees: balance::zero(),
        };
        transfer::share_object(state);
        let publisher = tx_context::sender(ctx);
        transfer::transfer(admin, publisher);
        transfer::transfer(relayer, publisher);
    }

    // ─── Public entry — the only writer (relayer-submitted) ──────────────────
    /// Forward `payment` to `recipient`, skimming a fee into `accumulated_fees`.
    /// `relayer_cap` is the capability — the runtime cost is a capability
    /// auth rather than an address==relayer check, and the Move type system
    /// refuses to compile a call lacking the `RelayerCap` arg (or aborts at
    /// runtime if a fake cap is supplied — caps are non-forgable resources).
    public(package) entry fun relay(
        _relayer_cap: &RelayerCap,
        state: &mut RelayerState,
        recipient: address,
        ephemeral_key: vector<u8>,
        view_tag: u8,
        mut payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);
        // Reject the zero address. On Sui the zero address is `0x0`; the
        // "this" address has no stable analog so we check only zero here
        // (matching EVM's `recipient != address(0)`).
        assert!(recipient != @0x0, EInvalidRecipient);

        assert!(state.fee_bps <= state.max_fee_bps, EFeeBpsTooHigh);

        // Fee math (identical to the EVM contract):
        //   fee = amount * fee_bps / fee_denominator
        //   net = amount - fee
        let fee = amount * state.fee_bps / state.fee_denominator;
        let net = amount - fee;

        // Effects: accrue fee, increment total_relayed (by the *net* amount,
        // matching the EVM `_totalRelayed += transferAmount`).
        if (fee > 0) {
            // `coin::split` returns a Coin worth `fee` taken off `payment`;
            // fold it into the accrued-fee Balance via `coin::into_balance` +
            // `balance::join` (which returns the new total; we discard it).
            let fee_coin = coin::split(&mut payment, fee, ctx);
            let fee_total = balance::join(&mut state.accumulated_fees, coin::into_balance(fee_coin));
            let _ = fee_total;
        };
        state.total_relayed = state.total_relayed + net;

        // Interaction: forward the net to `recipient`. On Sui this is
        // infallible if the coin is well-formed (no EVM-style `require(ok)`
        // needed).
        transfer::public_transfer(payment, recipient);

        // Unlinkable recipient anchor: sha3_256 of the recipient's bytes. The
        // recipient can later prove ownership by revealing the address; a
        // casual observer cannot invert the digest to read the address.
        let stealth_address_hash = hash::sha3_256(address::to_bytes(recipient));

        event::emit(PrivateTransfer {
            stealth_address_hash,
            ephemeral_key,
            view_tag,
            amount: net,
            fee,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    // ─── Admin writes (AdminCap-gated) ────────────────────────────────────────
    /// Raise or lower the protocol fee, in basis points. Capped at
    /// `max_fee_bps` (100 == 1%). Emits `FeeRateUpdated`.
    public(package) entry fun set_fee_bps(_admin: &AdminCap, state: &mut RelayerState, new_fee_bps: u64) {
        assert!(new_fee_bps <= state.max_fee_bps, EFeeBpsTooHigh);
        let old = state.fee_bps;
        state.fee_bps = new_fee_bps;
        event::emit(FeeRateUpdated { old_rate: old, new_rate: new_fee_bps });
    }

    /// Withdraw all accrued fees to `to`. Zero fee Balance at once (effects),
    /// then mint a Coin from the split Balance + transfer to `to`
    /// (interaction), the canonical checks-effects-interactions pattern —
    /// kept from the EVM contract even though Move has no reentrancy, as a
    /// free safety belt.
    public(package) entry fun withdraw_fees(
        _admin: &AdminCap,
        state: &mut RelayerState,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert!(to != @0x0, EInvalidRecipient);
        let amount = balance::value(&state.accumulated_fees);
        assert!(amount > 0, EWithdrawZero);
        // Effects: pull the full balance off the state first.
        let withdrawn = balance::split(&mut state.accumulated_fees, amount);
        // Interaction: wrap into a Coin and move it out.
        transfer::public_transfer(coin::from_balance(withdrawn, ctx), to);
        event::emit(FeesWithdrawn { to, amount });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Current fee rate in basis points (0..=max_fee_bps).
    public fun fee_bps(state: &RelayerState): u64 { state.fee_bps }
    /// Hard cap on fee_bps, set at init. 100 == 1%.
    public fun max_fee_bps(state: &RelayerState): u64 { state.max_fee_bps }
    /// Fee denominator. Always 10000.
    public fun fee_denominator(state: &RelayerState): u64 { state.fee_denominator }
    /// Total SUI ever forwarded to stealth recipients (net of fees). Monotonic.
    public fun total_relayed(state: &RelayerState): u64 { state.total_relayed }
    /// Current accrued, withdrawable fee balance.
    public fun accumulated_fees(state: &RelayerState): u64 {
        balance::value(&state.accumulated_fees)
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──
    /// Fresh shared-state shape identical to what `init` would produce, but
    /// owned by the test rather than published-shared. Lets a test mint the
    /// `RelayerState` without invoking the publish-time `init` flow.
    #[test_only]
    public fun new_test_state(fee_bps: u64, ctx: &mut TxContext): RelayerState {
        assert!(fee_bps <= 100, EFeeBpsTooHigh);
        RelayerState {
            id: object::new(ctx),
            fee_bps,
            max_fee_bps: 100,
            fee_denominator: 10000,
            total_relayed: 0,
            accumulated_fees: balance::zero(),
        }
    }

    /// Mint an `AdminCap` for a test. The test owns it (caller-is-admin is
    /// enforced by which cap you pass to a gated entry, not by object identity).
    #[test_only]
    public fun new_test_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    /// Mint a `RelayerCap` for a test.
    #[test_only]
    public fun new_test_relayer_cap(ctx: &mut TxContext): RelayerCap {
        RelayerCap { id: object::new(ctx) }
    }

    /// Destroy a `RelayerState` after a test. `table`-backed `accumulated_fees`
    /// must be empty (call `withdraw_fees`/drain first), else `destroy_zero`
    /// aborts — which is the desired invariant: no test leaves stranded SUI.
    #[test_only]
    public fun destroy_test_state(state: RelayerState) {
        let RelayerState {
            id,
            fee_bps: _,
            max_fee_bps: _,
            fee_denominator: _,
            total_relayed: _,
            accumulated_fees,
        } = state;
        balance::destroy_zero(accumulated_fees);
        object::delete(id);
    }

    /// Destroy a test `AdminCap`. Both cap types are `key + store` with only an
    /// `id` field, so destructuring + `object::delete` is the full cleanup.
    #[test_only]
    public fun destroy_test_admin_cap(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }

    /// Destroy a test `RelayerCap`.
    #[test_only]
    public fun destroy_test_relayer_cap(cap: RelayerCap) {
        let RelayerCap { id } = cap;
        object::delete(id);
    }
}
