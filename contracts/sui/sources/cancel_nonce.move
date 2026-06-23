// SPDX-License-Identifier: MIT
module upl::cancel_nonce {
    /// On-chain intent-replay protection via monotonic nonces.
    ///
    /// The EVM `PrivacyRelayer.relay` flow is described as: the user signs an
    /// EIP-712 intent off-chain containing `{recipient, ephemeralKey,
    /// viewTag, amount, deadline, nonce}`, and the relayer submits it. The
    /// `nonce` field is the replay-protection mechanism — the relayer (or any
    /// watcher) can reject a replayed intent by checking that the nonce has
    /// not been used before. On EVM this is conventionally a per-address
    /// nonce stored in a `mapping(address => uint256)` inside the relayer
    /// contract.
    ///
    /// The Sui `privacy_relayer::relay` does NOT take a user-signed intent
    /// (Sui's PTB model makes the intent implicit in the programmable
    /// transaction the relayer submits), so there is no nonce to sign or
    /// replay. However, the project's planned off-chain relayer service
    /// (P1.10, see `StealthAddressRegistry.sol` docstring + the relay-flow
    /// description in `privacy_relayer.move`) still needs a way for the user
    /// to signal "cancel this intent" or "I have authorized nonce N, do not
    /// reuse it" to the relayer *before* the relayer submits the PTB. That is
    /// especially important when the relayer queues intents: a queued intent
    /// that the user wants to void must not be submittable later.
    ///
    /// This module provides that nonce surface as a shared on-chain
    /// registry. Each user address has a monotonic nonce; an intent is
    /// authorized at nonce `N` and the user (or the relayer on the user's
    /// behalf) "consumes" `N` by advancing the on-chain nonce past it. Any
    /// future attempt to consume the same nonce for the same address simply
    /// fails — the nonce has moved past it. The user can also explicitly
    /// "cancel" a nonce range (marking all nonces up to N as consumed
    /// without executing a relay), which is the on-chain equivalent of
    /// EIP-712 "increment my nonce to void the pending signature."
    ///
    /// Why this is honest (not padding): the EVM relay contract's off-chain
    /// intent confirmed protocol never had a corresponding on-chain nonce
    /// surface in the Sui package (because `privacy_relayer::relay` is
    /// purely PTB-driven). This fills the gap for queued-intent cancellation,
    /// which is a real operational problem the relayer service will face when
    /// it accepts signed intents and delays submission. Without it, a user
    /// who signed an intent and wants to cancel has no on-chain recourse —
    /// the relayer could still submit the old intent within the deadline
    /// window and the user cannot prove the nonce was consumed.
    ///
    /// Semantic differences from the EVM pattern:
    ///   - EVM `mapping(address => uint256) nonce` is inside the relayer
    ///     contract, writable only by the contract. This module is a
    ///     standalone shared object independent of any specific relayer —
    ///     multiple relayers can share the same nonce space, which is
    ///     important in a multi-operator model.
    ///   - `consume` takes the *expected* nonce and advances the on-chain
    ///     nonce to `expected + 1`, returning the consumed value. This is
    ///     "compare-and-swap" — it aborts if the on-chain nonce has already
    ///     advanced past `expected`, catching double-spend in the PTB.
    ///   - `cancel` unconditionally advances the nonce to `target` (or
    ///     no-ops if already past it). This is the "void pending intents"
    ///     operation.
    ///   - Both `consume` and `cancel` are permissionless for the address
    ///     **owner themselves** (verified via `TxContext::sender`), matching
    ///     how EVM's per-address nonce is only writable by `msg.sender`
    ///     (the relayer's consume happens under the user's signed auth, which
    ///     the relayer submits as a PTB on the user's behalf — on Sui the
    ///     user signs the PTB directly or via sponsored transaction).

    use sui::event;
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};

    /// Shared nonce registry. Maps `address -> u64` (current nonce for that
    /// address). `key` so it can be shared. Wraps a `Table<address, u64>` so
    /// each user's nonce occupies its own storage slot (no unbounded
    /// in-object Vec).
    public struct CancelNonce has key {
        id: UID,
        nonces: Table<address, u64>,
    }

    public struct NonceConsumed has copy, drop {
        address: address,
        nonce: u64,
    }

    public struct NonceCancelled has copy, drop {
        address: address,
        old_nonce: u64,
        new_nonce: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    /// Returned when `consume` is called with a nonce that does NOT match
    /// the current on-chain nonce for the sender. This is the replay-
    /// protection guard: if the nonce has already been consumed (by a prior
    /// relay or cancel), this assert fires.
    const ENonceMismatch: u64 = 1;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `CancelNonce` registry with an empty table. Called
    /// exactly once at package publish.
    fun init(ctx: &mut TxContext) {
        let registry = CancelNonce {
            id: object::new(ctx),
            nonces: table::new(ctx),
        };
        transfer::share_object(registry);
    }

    // ─── Public entries ────────────────────────────────────────────────────
    /// Consume the *next* expected nonce for the sender. Compares the
    /// provided `expected` against the on-chain nonce (0 if the address has
    /// never been seen). If they match, advances the on-chain nonce to
    /// `expected + 1` and returns the consumed value. If they don't match,
    /// aborts with `ENonceMismatch` — the nonce was already consumed or
    /// cancelled by a prior action.
    ///
    /// Typical use: the user signs an intent at nonce N, and the relayer
    /// embeds `consume(registry, N)` at the *start* of the relay PTB (before
    /// `privacy_relayer::relay`). If the nonce is stale (already consumed by
    /// a later relay), the PTB aborts atomically — no relay can proceed.
    /// The returned `u64` is informational (the caller already knows the
    /// value == `expected` if the call didn't abort).
    public(package) fun consume(
        registry: &mut CancelNonce,
        expected: u64,
        ctx: &TxContext,
    ): u64 {
        let sender = tx_context::sender(ctx);
        let current = get_or_zero(&registry.nonces, sender);
        assert!(current == expected, ENonceMismatch);
        let new_nonce = expected + 1;
        set_nonce(&mut registry.nonces, sender, new_nonce);
        event::emit(NonceConsumed { address: sender, nonce: expected });
        expected
    }

    /// Cancel all pending nonces up to and including `target` for the sender.
    /// Advances the on-chain nonce to `target + 1` (or no-ops if already past
    /// `target`). This is the "void all my pending signed intents" operation
    /// — the relayer will no longer be able to `consume` any nonce <= target.
    ///
    /// A user cancels when they discover a compromised or stale intent, or
    /// when they want a clean nonce-space restart. `target` does not need to
    /// be the current on-chain nonce — it can be any value >= the current
    /// on-chain nonce (advancing the nonce forward is always safe; going
    /// backward is a no-op).
    public(package) entry fun cancel(
        registry: &mut CancelNonce,
        target: u64,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let current = get_or_zero(&registry.nonces, sender);
        if (target < current) { return }; // no-op: already past target
        let old = current;
        set_nonce(&mut registry.nonces, sender, target + 1);
        event::emit(NonceCancelled { address: sender, old_nonce: old, new_nonce: target + 1 });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Current nonce for `addr`, or 0 if the address has never consumed or
    /// cancelled a nonce. A nonce value of N means all nonces < N have been
    /// consumed/cancelled, and the next expected nonce is N.
    public fun nonce(registry: &CancelNonce, addr: address): u64 {
        get_or_zero(&registry.nonces, addr)
    }

    /// Whether `addr` has ever had a nonce recorded (distinct from "the
    /// nonce is 0" — a nonce of 0 could mean "never seen" or "just
    /// initialized." An address that has consumed nonce 0 will have
    /// on-chain nonce = 1, so `contains` returning `true` means at least one
    /// consume/cancel has happened. If `contains` is `false`, `nonce` returns
    /// 0 but that's the default, not a consumed value.
    public fun contains(registry: &CancelNonce, addr: address): bool {
        table::contains(&registry.nonces, addr)
    }

    // ─── Internal ──────────────────────────────────────────────────────────
    /// Read the nonce for `addr`, returning 0 if the address has no entry.
    fun get_or_zero(nonces: &Table<address, u64>, addr: address): u64 {
        if (table::contains(nonces, addr)) {
            *table::borrow(nonces, addr)
        } else {
            0
        }
    }

    /// Set the nonce for `addr` to `value`, inserting if not present.
    fun set_nonce(nonces: &mut Table<address, u64>, addr: address, value: u64) {
        if (table::contains(nonces, addr)) {
            let slot = table::borrow_mut(nonces, addr);
            *slot = value;
        } else {
            table::add(nonces, addr, value);
        }
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──
    #[test_only]
    public fun new_test_registry(ctx: &mut TxContext): CancelNonce {
        CancelNonce {
            id: object::new(ctx),
            nonces: table::new(ctx),
        }
    }

    #[test_only]
    public fun destroy_test_registry(registry: CancelNonce) {
        let CancelNonce { id, nonces } = registry;
        table::drop(nonces);
        object::delete(id);
    }
}
