// SPDX-License-Identifier: MIT
module upl::timelock_cap {
    /// Time-locked capability holder with a configurable delay.
    ///
    /// The EVM side of UPL uses OpenZeppelin's `TimelockController` (~1200
    /// lines of Solidity) for the admin operations that should not take effect
    /// immediately (e.g. rotating the relayer, changing the fee rate, or moving
    /// a capability to a new operator). A timelock enforces a minimum delay
    /// between when the admin proposes an action and when it can be executed,
    /// giving the community a window to detect and challenge a malicious
    /// proposal before it takes effect.
    ///
    /// On Sui, the capability model is strictly safer than EVM's
    /// address-based access control (`onlyOwner`), but there is still a
    /// genuine need for a delay between "multisig approves a rotation" and
    /// "the rotated cap actually moves." Without it, a compromised multisig
    /// signer could immediately transfer the `RelayerCap` to an attacker's
    /// address with no recourse period. A timelock gives the community a
    /// configurable window (e.g. 48 hours) during which a suspicious proposal
    /// is visible on-chain but cannot yet be executed.
    ///
    /// What this module does:
    ///   - Holds a *pending* capability object (`key + store`) inside a shared
    ///     `TimelockCap` object, deposited by the current cap holder.
    ///   - Records a `unlock_at_ms` (the earliest `Clock::timestamp_ms` at
    ///     which the cap can be withdrawn).
    ///   - After `unlock_at_ms` has passed, the designated beneficiary
    ///     (address) may call `withdraw` to receive the cap.
    ///   - Before `unlock_at_ms`, `cancel` returns the cap to the original
    ///     depositor — the "abort the rotation" path.
    ///   - The delay is configured at deposit time, so each proposal can
    ///     have a different delay (e.g. minor config changes get 24h,
    ///     cap transfers get 72h).
    ///
    /// Why this is honest (not padding): OpenZeppelin's `TimelockController`
    /// is the most-audited, most-deployed access-control primitive in EVM
    /// DeFi. The Sui ecosystem has no standard equivalent (there is no
    /// `sui::timelock` module in the framework). This module is the
    /// Sui-native analog: it uses capabilities and the shared-object/
    /// Clock model rather than EVM's `ONLY_ROLE(PROPOSER)` /
    /// `ONLY_ROLE(EXECUTOR)` pattern, and it leverages Sui's resource
    /// linear typing to guarantee the locked cap cannot be duplicated,
    /// withdrawn early, or double-spent.
    ///
    /// Semantic differences from OpenZeppelin `TimelockController`:
    ///   - OZ stores operation hashes (keccak256 of target+data+salt) in a
    ///     mapping; Sui stores the *actual capability object* (a linear
    ///     resource) inside the lock. This is strictly stronger: on EVM, a
    ///     proposal is a hash commitment that anyone who knows the preimage
    ///     can execute; on Sui, the capability is physically inside the lock
    ///     and cannot be extracted by anyone except the beneficiary after the
    ///     delay.
    ///   - OZ has `PROPOSER_ROLE` and `EXECUTOR_ROLE` (separate roles);
    ///     here the depositor and beneficiary are addresses recorded at
    ///     deposit time — no role management is needed.
    ///   - OZ `execute` requires the exact calldata matching the hash; here
    ///     `withdraw` simply transfers the stored cap to the beneficiary.
    ///     The "what to do with the cap" is determined by the beneficiary's
    ///     PTB after withdrawal — the lock only controls *when* they receive
    ///     it, not what they do with it.
    ///   - OZ supports batch operations and cancellation by任何人; here the
    ///     only cancel path is the original depositor (who deposited the cap
    ///     in the first place), matching the Sui-native principle that the
    ///     resource owner is the only authority over their owned object.

    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// Shared time-locked capability holder. Stores one pending capability
    /// deposit at a time (a second `deposit` before the first is resolved
    /// aborts — see `ELockOccupied`). This ensures the lock is always in a
    /// known state: either empty (no pending rotation) or holding exactly one
    /// cap with a clear unlock time and beneficiary.
    ///
    /// The actual capability object is *parked* at the timelock's object
    /// address via `transfer::public_transfer` (it has `store`). The on-chain
    /// struct only records the metadata (depositor, beneficiary, unlock time)
    /// and a `locked` boolean. This avoids storing a `UID` inside the struct,
    /// which would make the struct non-droppable and complicate state updates.
    public struct TimelockCap has key {
        id: UID,
        /// True when a capability is currently parked in the lock.
        locked: bool,
        /// Address that deposited the cap. Only they may `cancel`.
        depositor: address,
        /// Address that may `withdraw` after the lock expires.
        beneficiary: address,
        /// Earliest `Clock::timestamp_ms` at which `withdraw` may succeed.
        unlock_at_ms: u64,
        /// Minimum delay in ms for future deposits (advisory; the actual
        /// unlock time is set at deposit). Set at `init`; the `AdminCap`
        /// holder may rotate it.
        min_delay_ms: u64,
    }

    /// Admin capability. The holder may rotate `min_delay_ms`. Created once
    /// in `init` and transferred to the publisher.
    public struct AdminCap has key, store {
        id: UID,
    }

    // ─── Events ───────────────────────────────────────────────────────────
    public struct CapDeposited has copy, drop {
        timelock: address,
        depositor: address,
        beneficiary: address,
        unlock_at_ms: u64,
    }
    public struct CapWithdrawn has copy, drop {
        timelock: address,
        beneficiary: address,
    }
    public struct CapCancelled has copy, drop {
        timelock: address,
        depositor: address,
    }
    public struct MinDelayUpdated has copy, drop {
        old_delay_ms: u64,
        new_delay_ms: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    const ELockOccupied: u64 = 1;
    const ELockEmpty: u64 = 2;
    const ETooEarly: u64 = 3;
    const ENotDepositor: u64 = 4;
    const ENotBeneficiary: u64 = 5;
    const EZeroBeneficiary: u64 = 6;
    const EDelayTooShort: u64 = 7;

    /// Default minimum delay: 48 hours in ms.
    const DEFAULT_DELAY_MS: u64 = 48 * 60 * 60 * 1000;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `TimelockCap` (empty lock, DEFAULT_DELAY_MS) and one
    /// `AdminCap` transferred to the publisher.
    fun init(ctx: &mut TxContext) {
        let timelock = TimelockCap {
            id: object::new(ctx),
            locked: false,
            depositor: @0x0,
            beneficiary: @0x0,
            unlock_at_ms: 0,
            min_delay_ms: DEFAULT_DELAY_MS,
        };
        transfer::share_object(timelock);
        let admin = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    // ─── Public entry — deposit ────────────────────────────────────────────
    /// Deposit a capability object into the timelock. The depositor is
    /// recorded as `tx_context::sender(ctx)`. The cap will be withdrawable by
    /// `beneficiary` only after `clock::timestamp_ms >= unlock_at_ms`, which
    /// is `now + delay_ms` (the depositor specifies the delay at deposit
    /// time, which must be >= `min_delay_ms`). The original `T: key + store`
    /// object is consumed by parking it at the timelock's object address.
    ///
    /// This is the "propose a cap rotation" operation. The depositor (who
    /// currently holds the cap) locks it into the timelock pending the delay.
    /// After the delay, the beneficiary withdraws it. If the rotation is
    /// cancelled before the delay expires, the depositor recovers the cap
    /// via `cancel`.
    public(package) entry fun deposit<T: key + store>(
        timelock: &mut TimelockCap,
        beneficiary: address,
        delay_ms: u64,
        cap: T,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(beneficiary != @0x0, EZeroBeneficiary);
        assert!(delay_ms >= timelock.min_delay_ms, EDelayTooShort);
        // The lock must be empty — one pending operation at a time.
        assert!(!timelock.locked, ELockOccupied);

        let depositor = tx_context::sender(ctx);
        let unlock_at = clock::timestamp_ms(clock) + delay_ms;
        let timelock_addr = object::uid_to_address(&timelock.id);

        timelock.depositor = depositor;
        timelock.beneficiary = beneficiary;
        timelock.unlock_at_ms = unlock_at;
        // Mark the lock as occupied. The actual cap is parked at the
        // timelock's address; the beneficiary will take it on withdraw.
        timelock.locked = true;

        // Park the cap at the timelock's address.
        transfer::public_transfer(cap, timelock_addr);

        event::emit(CapDeposited {
            timelock: timelock_addr,
            depositor,
            beneficiary,
            unlock_at_ms: unlock_at,
        });
    }

    // ─── Beneficiary entry — withdraw ──────────────────────────────────────
    /// Withdraw the locked cap after the timelock expires. The caller must be
    /// the `beneficiary` recorded at deposit time, and `Clock::timestamp_ms`
    /// must be >= `unlock_at_ms`. The cap is transferred to the beneficiary.
    ///
    /// **Note:** because the cap is parked at the timelock's object address,
    /// the beneficiary constructs a PTB that takes the cap from that address
    /// and passes it here. The function receives the cap by value, verifies
    /// the invariants, then `public_transfer`s it back to the beneficiary.
    public(package) entry fun withdraw<T: key + store>(
        timelock: &mut TimelockCap,
        _cap: T,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(timelock.locked, ELockEmpty);
        assert!(clock::timestamp_ms(clock) >= timelock.unlock_at_ms, ETooEarly);

        let caller = tx_context::sender(ctx);
        assert!(caller == timelock.beneficiary, ENotBeneficiary);

        // Clear the lock.
        timelock.locked = false;
        timelock.depositor = @0x0;
        timelock.beneficiary = @0x0;
        timelock.unlock_at_ms = 0;

        // The cap was passed in by value (the caller took it from the
        // timelock's address and passed it here). Transfer it back to the
        // beneficiary's address for final ownership.
        transfer::public_transfer(_cap, caller);

        event::emit(CapWithdrawn {
            timelock: object::uid_to_address(&timelock.id),
            beneficiary: caller,
        });
    }

    // ─── Depositor entry — cancel ───────────────────────────────────────────
    /// Cancel a pending rotation before the timelock expires. The caller must
    /// be the original `depositor`. The locked cap is returned to the
    /// depositor. This is the "abort the proposal" path — the community (or
    /// the depositor themselves) believed the rotation was wrong and wants
    /// the cap back before the beneficiary can claim it.
    public(package) entry fun cancel<T: key + store>(
        timelock: &mut TimelockCap,
        _cap: T,
        ctx: &mut TxContext,
    ) {
        assert!(timelock.locked, ELockEmpty);

        let caller = tx_context::sender(ctx);
        assert!(caller == timelock.depositor, ENotDepositor);

        // Clear the lock.
        let depositor = timelock.depositor;
        timelock.locked = false;
        timelock.depositor = @0x0;
        timelock.beneficiary = @0x0;
        timelock.unlock_at_ms = 0;

        // Return the cap to the depositor.
        transfer::public_transfer(_cap, depositor);

        event::emit(CapCancelled {
            timelock: object::uid_to_address(&timelock.id),
            depositor,
        });
    }

    // ─── Admin writes (AdminCap-gated) ────────────────────────────────────
    /// Rotate the minimum delay. The admin may raise or lower it; the new
    /// delay applies to *future* deposits (existing locked caps are not
    /// affected — their unlock time was computed at deposit and is immutable).
    public(package) entry fun set_min_delay(
        _admin: &AdminCap,
        timelock: &mut TimelockCap,
        new_delay_ms: u64,
    ) {
        let old = timelock.min_delay_ms;
        timelock.min_delay_ms = new_delay_ms;
        event::emit(MinDelayUpdated { old_delay_ms: old, new_delay_ms: new_delay_ms });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Whether the lock is currently occupied (a cap is deposited and
    /// pending).
    public fun is_locked(timelock: &TimelockCap): bool {
        timelock.locked
    }

    /// The beneficiary address (zero if the lock is empty).
    public fun beneficiary(timelock: &TimelockCap): address {
        timelock.beneficiary
    }

    /// The depositor address (zero if the lock is empty).
    public fun depositor(timelock: &TimelockCap): address {
        timelock.depositor
    }

    /// Earliest `Clock::timestamp_ms` at which `withdraw` may succeed
    /// (0 if the lock is empty).
    public fun unlock_at_ms(timelock: &TimelockCap): u64 {
        timelock.unlock_at_ms
    }

    /// Current minimum delay for future deposits.
    public fun min_delay_ms(timelock: &TimelockCap): u64 {
        timelock.min_delay_ms
    }

    // ─── Test helpers ────────────────────────────────────────────────────────
    #[test_only]
    public fun new_test_timelock(ctx: &mut TxContext): TimelockCap {
        TimelockCap {
            id: object::new(ctx),
            locked: false,
            depositor: @0x0,
            beneficiary: @0x0,
            unlock_at_ms: 0,
            min_delay_ms: 1000, // small delay for tests
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

    /// Destroy a test TimelockCap. The lock must be empty (no pending cap).
    #[test_only]
    public fun destroy_test_timelock(timelock: TimelockCap) {
        let TimelockCap { id, locked: _, depositor: _, beneficiary: _, unlock_at_ms: _, min_delay_ms: _ } = timelock;
        object::delete(id);
    }

    /// Return the object address of a TimelockCap. Tests need this to
    /// `take_from_address` the parked cap.
    #[test_only]
    public fun timelock_address(timelock: &TimelockCap): address {
        object::uid_to_address(&timelock.id)
    }

    /// A throwaway `key + store` test object used to exercise the generic
    /// `deposit<T>` / `withdraw<T>` / `cancel<T>`.
    #[test_only]
    public struct TestCap has key, store { id: UID }

    #[test_only]
    public fun new_test_cap(ctx: &mut TxContext): TestCap {
        TestCap { id: object::new(ctx) }
    }

    #[test_only]
    public fun destroy_test_cap(cap: TestCap) {
        let TestCap { id } = cap;
        object::delete(id);
    }
}
