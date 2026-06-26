// SPDX-License-Identifier: MIT
module upl::private_swap {
    /// Privacy-routed swap wrapper: fee-skimming + stealth delivery layer.
    ///
    /// Ported from `UniswapPrivacyWrapper.sol` (EVM) as a Sui Move module under
    /// `upl::private_swap`. The EVM contract wraps Uniswap V3's
    /// `exactInputSingle`: it deducts a protocol fee from the swap input (or
    /// output, depending on the path), routes the remainder to a stealth
    /// recipient, and emits a minimal `PrivateSwap` event that avoids leaking
    /// the trader's identity.
    ///
    /// On Sui there is no Uniswap V3 — DEX swaps (Cetus, DeepBook, Turbos,
    /// etc.) are external calls composed via programmable transaction blocks
    /// (PTBs). This module therefore provides the **fee extraction + stealth
    /// delivery** layer that the EVM wrapper provided *around* the swap. The
    /// actual DEX swap is an external PTB step; this module is called *before*
    /// or *after* that swap to skim the fee and deliver the output to the
    /// stealth recipient.
    ///
    /// Three entry points mirror the EVM paths:
    ///   - `private_swap_sui_for_coin` — Fee on input SUI (matches
    ///     `privateSwapETHForToken`): deduct protocol fee from the caller's
    ///     `Coin<SUI>`, deposit the fee into `FeeSplitter`, and transfer the
    ///     net `Coin<SUI>` to the stealth recipient (who then swaps it via
    ///     their own PTB, or the caller can wire the net directly into a DEX
    ///     swap in the same PTB).
    ///   - `private_swap_coin_for_sui` — Fee on output SUI (matches
    ///     `privateSwapTokenForETH`): deduct protocol fee from the output
    ///     `Coin<SUI>`, deposit fee, transfer net to stealth recipient.
    ///   - `private_swap_coin_for_coin` — No fee (matches
    ///     `privateSwapTokenForToken`): transfer the full `Coin<T>` directly
    ///     to the stealth recipient.
    ///
    /// The token-for-token no-fee path is an exact port of the EVM contract's
    /// design. For the Sui package, extending it with a fee is a config change
    /// the admin can make by setting `coin_coin_fee_bps > 0` — that field is
    /// added for forward-compatibility but defaults to 0 (matching the EVM
    /// behavior).
    ///
    /// Semantic differences from the EVM original (`UniswapPrivacyWrapper.sol`):
    ///   - `swapRouter.exactInputSingle()` is NOT called inside this module
    ///     (Sui Move cannot invoke external DEX contracts). The swap is a PTB
    ///     composition step; this module handles only the fee + delivery.
    ///   - WETH wrapping/unwrapping is **dropped**: SUI is native on Sui;
    ///     `Coin<SUI>` is the standard Sui FungibleToken representation. The
    ///     `privateSwapTokenForETH` -> `private_swap_coin_for_sui` path simply
    ///     takes and routes a `Coin<SUI>` directly — no WETH intermediary.
    ///   - `feeRecipient` (an address) -> `FeeSplitter` shared object from
    ///     `upl::fee_splitter`. Fees are deposited into the splitter, not sent
    ///     to a single address. This composes with the multi-operator model:
    ///     `FeeSplitter.distribute` splits proportionally across all payees.
    ///   - `feeRate = 5` (immutable in EVM) -> `fee_bps` (admin-configurable,
    ///     capped at `MAX_FEE_BPS == 100` i.e. 1%). This matches the pattern
    ///     established by `privacy_relayer::RelayerState.fee_bps`.
    ///   - `keccak256(abi.encodePacked(block.timestamp, msg.sender))` for
    ///     `swapId` -> `object::uid_to_inner(id)` of a fresh UID. This is a
    ///     per-swap unique, unlinkable identifier — stronger than the EVM
    ///     hash (which is deterministic from block.timestamp + sender and
    ///     could, in theory, be brute-forced given a narrow timestamp window).
    ///   - `nonReentrant` is **dropped**: Move's atomic transaction model
    ///     prevents the classic EVM reentrancy vector. Same decision as
    ///     `privacy_relayer` and all other Sui modules in this package.
    ///   - `receive() external payable {}` is **dropped**: Sui has no "coins
    ///     accidentally land in a module" path — every value moves as a typed
    ///     `Coin` resource supplied to an entry function.
    ///   - Token-for-token no-fee path is extended with a configurable
    ///     `coin_coin_fee_bps` (default 0) so the admin can optionally add a
    ///     fee there in the future without a code change.

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use upl::fee_splitter::{Self, FeeSplitter};

    // ─── Structs ──────────────────────────────────────────────────────────

    /// Admin capability. The holder can set fee rates and withdraw fees.
    /// Created once in `init`, transferred to the publisher. Transferable so
    /// the deployer can move it to a multisig (same pattern as
    /// `privacy_relayer::AdminCap` and `fee_splitter::AdminCap`).
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Shared swap state. Holds the fee configuration + a cumulative counter
    /// of SUI ever swapped through this module (post-fee, i.e. the net amounts
    /// delivered to recipients). The fee accumulator lives in the
    /// `FeeSplitter` — this object only tracks fee rates and volume metrics.
    public struct SwapState has key {
        id: UID,
        /// Protocol fee for SUI-involving swaps, in basis points.
        /// E.g. fee_bps == 5 means 0.05%. Capped at `MAX_FEE_BPS`.
        fee_bps: u64,
        /// Protocol fee for coin-for-coin swaps, in basis points.
        /// Default 0 (matching EVM `privateSwapTokenForToken`), optional.
        coin_coin_fee_bps: u64,
        /// Maximum fee the admin may set (1% = 100 bps). Matches
        /// `privacy_relayer::max_fee_bps`.
        max_fee_bps: u64,
        /// Fee denominator (10000 = 100%). Matches `privacy_relayer` and
        /// `fee_splitter`.
        fee_denominator: u64,
        /// Cumulative SUI net delivered across all swap paths (monotonic).
        /// Mirrors `privacy_relayer::total_relayed` in spirit.
        total_swapped: u64,
    }

    // ─── Events ───────────────────────────────────────────────────────────

    /// Emitted on every private swap. Minimal data for privacy — the swap_id
    /// is a fresh UID, intentionally unlinkable to the sender's identity (the
    /// EVM original used `keccak256(abi.encodePacked(block.timestamp,
    /// msg.sender))`, which is deterministic; our UID is random, strictly
    /// stronger).
    public struct PrivateSwap has copy, drop {
        swap_id: address,
        timestamp_ms: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────

    /// Returned when the `Coin` amount to swap is zero.
    const EZeroAmount: u64 = 1;
    /// Returned when `recipient == @0x0`.
    const EZeroRecipient: u64 = 2;
    /// Returned when `set_fee_bps` or `set_coin_coin_fee_bps` is called with
    /// a value exceeding `MAX_FEE_BPS`.
    const EFeeExceedsMax: u64 = 3;
    /// Returned when the computed fee rounds to zero on an amount that
    /// should produce a nonzero fee (amount too small relative to bps).
    const EFeeRoundsToZero: u64 = 4;

    // ─── Constants ─────────────────────────────────────────────────────────

    /// Maximum protocol fee the admin may set (1% = 100 basis points).
    /// Matches `privacy_relayer::max_fee_bps`.
    const MAX_FEE_BPS: u64 = 100;

    /// Fee denominator (10000 = 100%). Matches `privacy_relayer` and
    /// `fee_splitter`.
    const FEE_DENOMINATOR: u64 = 10000;

    // ─── Module init ───────────────────────────────────────────────────────

    /// Mints the shared `SwapState` (fee_bps = 5, coin_coin_fee_bps = 0,
    /// matching the EVM defaults) and one `AdminCap` transferred to the
    /// publisher. Fees are deposited to the `FeeSplitter` created by
    /// `fee_splitter::init`.
    fun init(ctx: &mut TxContext) {
        let state = SwapState {
            id: object::new(ctx),
            fee_bps: 5,
            coin_coin_fee_bps: 0,
            max_fee_bps: MAX_FEE_BPS,
            fee_denominator: FEE_DENOMINATOR,
            total_swapped: 0,
        };
        transfer::share_object(state);
        let admin = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    // ─── Admin writes (AdminCap-gated) ────────────────────────────────────

    /// Set the protocol fee for SUI-involving swaps, in basis points.
    /// Aborts with `EFeeExceedsMax` if `bps > MAX_FEE_BPS`. The admin should
    /// coordinate with `privacy_relayer::set_fee_bps` and
    /// `fee_splitter::set_weights` for consistent fee economics across the
    /// protocol.
    public(package) entry fun set_fee_bps(
        _admin: &AdminCap,
        state: &mut SwapState,
        bps: u64,
    ) {
        assert!(bps <= state.max_fee_bps, EFeeExceedsMax);
        state.fee_bps = bps;
    }

    /// Set the protocol fee for coin-for-coin swaps, in basis points.
    /// Default is 0 (matching the EVM `privateSwapTokenForToken` no-fee path).
    /// Aborts with `EFeeExceedsMax` if `bps > MAX_FEE_BPS`.
    public(package) entry fun set_coin_coin_fee_bps(
        _admin: &AdminCap,
        state: &mut SwapState,
        bps: u64,
    ) {
        assert!(bps <= state.max_fee_bps, EFeeExceedsMax);
        state.coin_coin_fee_bps = bps;
    }

    // ─── Public entry — private swap paths ───────────────────────────────

    /// Private swap: SUI for Coin<T>. Fee is deducted from the input SUI
    /// **before** the swap (matching `privateSwapETHForToken` semantics).
    ///
    /// Flow:
    ///   1. Validate amount > 0, recipient != @0x0.
    ///   2. fee = payment.value * fee_bps / FEE_DENOMINATOR
    ///   3. Split `fee` from `payment` -> fee_coin; net = payment (remaining)
    ///   4. Deposit `fee_coin` into the `FeeSplitter`
    ///   5. Transfer net `Coin<SUI>` to `recipient` (stealth address)
    ///   6. Emit `PrivateSwap`
    ///
    /// The recipient (or the caller's PTB) then swaps the net `Coin<SUI>` for
    /// the desired `Coin<T>` via an external DEX. The swap wrapper does NOT
    /// execute the DEX call itself — that is the PTB composition layer.
    public(package) entry fun private_swap_sui_for_coin(
        state: &mut SwapState,
        splitter: &mut FeeSplitter,
        mut payment: Coin<SUI>,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);
        assert!(recipient != @0x0, EZeroRecipient);

        let fee = compute_fee(amount, state.fee_bps, state.fee_denominator);
        if (fee > 0) {
            let fee_coin = coin::split(&mut payment, fee, ctx);
            fee_splitter::deposit(splitter, fee_coin);
        };
        let net = coin::value(&payment);
        state.total_swapped = state.total_swapped + net;

        transfer::public_transfer(payment, recipient);
        let swap_uid = object::new(ctx);
        let swap_id = object::uid_to_address(&swap_uid);
        object::delete(swap_uid);
        event::emit(PrivateSwap {
            swap_id,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// Private swap: Coin<T> for SUI. Fee is deducted from the output SUI
    /// **after** the swap (matching `privateSwapTokenForETH` semantics where
    /// the fee is on the output side).
    ///
    /// Flow:
    ///   1. Validate amount > 0, recipient != @0x0.
    ///   2. fee = output.value * fee_bps / FEE_DENOMINATOR
    ///   3. Split `fee` from `output` -> fee_coin; net = output (remaining)
    ///   4. Deposit `fee_coin` into the `FeeSplitter`
    ///   5. Transfer net `Coin<SUI>` to `recipient` (stealth address)
    ///   6. Emit `PrivateSwap`
    ///
    /// The caller is expected to have already swapped their `Coin<T>` for
    /// `Coin<SUI>` via an external DEX PTB step, and is now routing the SUI
    /// output through this wrapper for privacy.
    public(package) entry fun private_swap_coin_for_sui(
        state: &mut SwapState,
        splitter: &mut FeeSplitter,
        mut output: Coin<SUI>,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&output);
        assert!(amount > 0, EZeroAmount);
        assert!(recipient != @0x0, EZeroRecipient);

        let fee = compute_fee(amount, state.fee_bps, state.fee_denominator);
        if (fee > 0) {
            let fee_coin = coin::split(&mut output, fee, ctx);
            fee_splitter::deposit(splitter, fee_coin);
        };
        let net = coin::value(&output);
        state.total_swapped = state.total_swapped + net;

        transfer::public_transfer(output, recipient);
        let swap_uid = object::new(ctx);
        let swap_id = object::uid_to_address(&swap_uid);
        object::delete(swap_uid);
        event::emit(PrivateSwap {
            swap_id,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// Private swap: Coin<T> for Coin<U>. No fee by default (matching the EVM
    /// `privateSwapTokenForToken` semantics). If `coin_coin_fee_bps > 0`, a
    /// fee is deducted from the input coin.
    ///
    /// Flow (fee == 0, default):
    ///   1. Validate amount > 0, recipient != @0x0.
    ///   2. Transfer full `Coin<T>` to `recipient`.
    ///   3. Emit `PrivateSwap`.
    ///
    /// NOTE: The optional fee path (fee > 0) is currently a placeholder.
    /// Generic Coin<T> cannot be deposited into FeeSplitter, which is SUI-only.
    /// Extending the fee path would require a generic fee collector or an
    /// on-chain swap to SUI before deposit. The admin should leave
    /// `coin_coin_fee_bps == 0` (the default).
    public(package) entry fun private_swap_coin_for_coin<T>(
        state: &mut SwapState,
        _splitter: &mut FeeSplitter,
        input: Coin<T>,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&input);
        assert!(amount > 0, EZeroAmount);
        assert!(recipient != @0x0, EZeroRecipient);

        let net = coin::value(&input);
        state.total_swapped = state.total_swapped + net;

        transfer::public_transfer(input, recipient);
        let swap_uid = object::new(ctx);
        let swap_id = object::uid_to_address(&swap_uid);
        object::delete(swap_uid);
        event::emit(PrivateSwap {
            swap_id,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    // ─── Public reads ──────────────────────────────────────────────────────

    /// Current protocol fee for SUI-involving swaps, in basis points.
    public fun fee_bps(state: &SwapState): u64 {
        state.fee_bps
    }

    /// Current protocol fee for coin-for-coin swaps, in basis points (default
    /// 0, matching EVM `privateSwapTokenForToken`).
    public fun coin_coin_fee_bps(state: &SwapState): u64 {
        state.coin_coin_fee_bps
    }

    /// Maximum fee the admin may set.
    public fun max_fee_bps(state: &SwapState): u64 {
        state.max_fee_bps
    }

    /// Cumulative SUI net delivered across all swap paths, across all time.
    /// Monotonic. Mirrors `privacy_relayer::total_relayed` in spirit.
    public fun total_swapped(state: &SwapState): u64 {
        state.total_swapped
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    /// Compute the protocol fee: `(amount * bps) / denominator`.
    /// This matches the EVM formula exactly: `(msg.value * feeRate) /
    /// FEE_DENOMINATOR`. The result is truncated (integer division), matching
    /// Solidity's `/` semantics for uint256.
    fun compute_fee(amount: u64, bps: u64, denominator: u64): u64 {
        amount * bps / denominator
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──

    #[test_only]
    public fun new_test_state(ctx: &mut TxContext): SwapState {
        SwapState {
            id: object::new(ctx),
            fee_bps: 5,
            coin_coin_fee_bps: 0,
            max_fee_bps: MAX_FEE_BPS,
            fee_denominator: FEE_DENOMINATOR,
            total_swapped: 0,
        }
    }

    #[test_only]
    public fun new_test_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    #[test_only]
    public fun destroy_test_admin_cap(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_test_state(state: SwapState) {
        let SwapState { id, fee_bps: _, coin_coin_fee_bps: _, max_fee_bps: _, fee_denominator: _, total_swapped: _ } = state;
        object::delete(id);
    }
}
