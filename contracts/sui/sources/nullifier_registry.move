// SPDX-License-Identifier: MIT
module upl::nullifier_registry {
    /// Global double-spend prevention for shielded UTXOs via nullifier tracking.
    ///
    /// A nullifier is a 32-byte value uniquely derived from a shielded note
    /// (typically `hash(spending_key || note_commitment)` in ZK proof systems
    /// like Zcash/Tornado Cash). Once a nullifier is inserted into this
    /// registry, the same note cannot be spent again — attempting to insert a
    /// duplicate aborts with `EAlreadySpent`.
    ///
    /// The EVM side has no equivalent contract. The closest concept is the
    /// `nullifier` field in the ZKP input generation endpoint
    /// (`backend/server.py:1382`), but that value is a random placeholder —
    /// it is never checked for uniqueness or used for double-spend prevention.
    /// This module fills that gap with a proper on-chain nullifier set.
    ///
    /// This is the on-chain component that a future ZK proof system (Phase 3
    /// of the project roadmap, see `PROJECT_CONTEXT.md` task #7) would
    /// reference: the prover proves "I know the spending key for note X" and
    /// the verifier checks that the derived nullifier is NOT in this registry.
    /// Without this registry, even a perfect ZK proof system has no on-chain
    /// mechanism to prevent the same note from being spent twice.
    ///
    /// Design rationale:
    ///   - `spend` is **permissionless**: anyone can submit a nullifier. The
    ///     authorization (proving the submitter knows the spending key) is an
    ///     off-chain / future on-chain ZK verification concern. This matches
    ///     the EVM pattern where `nullifiers.insert(n)` is callable by the
    ///     relayer submitting the ZK proof — the relayer does not need
    ///     special permission to insert a nullifier, only a valid proof.
    ///   - `VecSet<vector<u8>>` is chosen over `VecSet<ID>` because nullifiers
    ///     are arbitrary 32-byte values, not Sui object IDs. Using `vector<u8>`
    ///     gives the most natural representation and avoids confusion with Sui
    ///     object identity semantics. On-chain storage cost is identical.
    ///   - No `AdminCap` is needed — this is a pure append-only set. There is
    ///     no admin operation (no removal, no reset). If a migration is ever
    ///     needed, the deployer publishes a new package and the relayer service
    ///     switches to the new registry.
    ///
    /// Semantic differences from the EVM pattern (hypothetical, since no
    /// EVM equivalent exists):
    ///   - EVM `mapping(bytes32 => bool) nullifiers` -> `VecSet<vector<u8>>`
    ///     with O(1) `contains` checks and set-level duplicate prevention.
    ///   - EVM nullifier is `bytes32` -> Sui `vector<u8>` (32 bytes). Same
    ///     entropy, different Move type.
    ///   - The EVM pattern typically includes `insert(nullifier)` inside a
    ///     `verifyAndSpend` function that also checks the ZK proof. On Sui,
    ///     ZK verification is a future feature; `spend` is the standalone
    ///     registry step that the future verifier will compose with.
    ///   - `NoCap` / permissionless design is a deliberate choice: on Sui,
    ///     the cost of a `spend` call is the gas to insert into the set (no
    ///     write-gas-griefing concern because the set only grows by 32 bytes
    ///     per call and the caller pays for the storage).

    use std::vector;
    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::vec_set::{Self, VecSet};

    // ─── Structs ──────────────────────────────────────────────────────────

    /// Shared nullifier registry. Holds the set of all spent nullifiers.
    /// `spend` inserts a new nullifier; `contains` checks for duplicates.
    /// Once inserted, a nullifier can never be removed — this is the
    /// append-only invariant that guarantees double-spend protection.
    public struct NullifierRegistry has key {
        id: UID,
        /// Set of spent nullifiers (32-byte vectors). `VecSet` gives O(1)
        /// contains and enforces uniqueness at the type level.
        nullifiers: VecSet<vector<u8>>,
    }

    // ─── Events ───────────────────────────────────────────────────────────

    /// Emitted when a nullifier is inserted (a shielded note is spent).
    public struct NullifierSpent has copy, drop {
        nullifier: vector<u8>,
    }

    // ─── Errors ────────────────────────────────────────────────────────────

    /// Returned when `spend` is called with a nullifier that already exists
    /// in the registry. This is the double-spend guard.
    const EAlreadySpent: u64 = 1;
    /// Returned when `spend` is called with a zero-length nullifier. A valid
    /// nullifier must be exactly 32 bytes.
    const EZeroNullifier: u64 = 2;
    /// Returned when `spend` is called with a nullifier that is not 32 bytes.
    /// Standard ZK nullifiers are 256-bit (32 bytes).
    const EInvalidNullifierLength: u64 = 3;

    // ─── Constants ─────────────────────────────────────────────────────────

    /// Expected nullifier length in bytes (256 bits). Matches Zcash /
    /// Tornado Cash / standard ZK nullifier conventions.
    const NULLIFIER_LENGTH: u64 = 32;

    // ─── Module init ───────────────────────────────────────────────────────

    /// Mints the shared `NullifierRegistry` with an empty nullifier set.
    /// Called exactly once at package publish. No `AdminCap` — this is a
    /// permissionless append-only set.
    fun init(ctx: &mut TxContext) {
        let registry = NullifierRegistry {
            id: object::new(ctx),
            nullifiers: vec_set::empty<vector<u8>>(),
        };
        transfer::share_object(registry);
    }

    // ─── Public entry — spend ────────────────────────────────────────────

    /// Insert a nullifier into the registry, marking a shielded note as spent.
    /// Aborts with `EAlreadySpent` if the nullifier already exists (double-
    /// spend attempt). Aborts with `EZeroNullifier` if the nullifier is empty.
    /// Aborts with `EInvalidNullifierLength` if the nullifier is not 32 bytes.
    ///
    /// Permissionless: anyone may call `spend`. The authorization (proving the
    /// submitter knows the spending key for the note that derived this
    /// nullifier) is the responsibility of the calling context — in the
    /// Phase-3 ZK system, the verifier will gate `spend` behind a proof check.
    public(package) entry fun spend(
        registry: &mut NullifierRegistry,
        nullifier: vector<u8>,
    ) {
        assert!(vector::length(&nullifier) > 0, EZeroNullifier);
        assert!(vector::length(&nullifier) == NULLIFIER_LENGTH, EInvalidNullifierLength);
        assert!(!vec_set::contains(&registry.nullifiers, &nullifier), EAlreadySpent);

        vec_set::insert(&mut registry.nullifiers, nullifier);
        event::emit(NullifierSpent { nullifier });
    }

    // ─── Public reads ──────────────────────────────────────────────────────

    /// Whether `nullifier` has been spent (exists in the registry).
    /// Returns `false` for nullifiers not yet inserted.
    public fun contains(registry: &NullifierRegistry, nullifier: &vector<u8>): bool {
        vec_set::contains(&registry.nullifiers, nullifier)
    }

    /// Number of spent nullifiers in the registry. Monotonic (insert-only).
    public fun len(registry: &NullifierRegistry): u64 {
        vec_set::length(&registry.nullifiers)
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──

    #[test_only]
    public fun new_test_registry(ctx: &mut TxContext): NullifierRegistry {
        NullifierRegistry {
            id: object::new(ctx),
            nullifiers: vec_set::empty<vector<u8>>(),
        }
    }

    #[test_only]
    public fun destroy_test_registry(registry: NullifierRegistry) {
        let NullifierRegistry { id, nullifiers: _ } = registry;
        object::delete(id);
    }

    // Need vector for length checks in the module body.
}
