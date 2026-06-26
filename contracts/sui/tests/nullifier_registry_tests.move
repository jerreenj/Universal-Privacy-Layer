// SPDX-License-Identifier: MIT
#[test_only]
module upl::nullifier_registry_tests {
    /// Tests for `upl::nullifier_registry`.
    ///
    /// Covers: new nullifier insertion, duplicate-spend abort, zero-length
    /// nullifier abort, invalid-length nullifier abort, contains-false for
    /// unknown nullifiers, and the len monotonic counter.
    ///
    /// Uses the Sui 2024 no-arg test form. Nullifiers are `vector<u8>` of
    /// exactly 32 bytes, matching the standard ZK nullifier convention.

    use sui::tx_context::TxContext;
    use upl::nullifier_registry as nr;
    use std::vector;

    /// Helper: create a 32-byte nullifier from a u64 seed (pads with zeros).
    fun make_nullifier(seed: u64): vector<u8> {
        let mut n = vector::empty<u8>();
        let mut i = 0;
        while (i < 31) {
            vector::push_back(&mut n, 0u8);
            i = i + 1;
        };
        // Last byte is the seed (truncated to u8 for test variety).
        vector::push_back(&mut n, (seed & 0xFF) as u8);
        n
    }

    /// Insert two distinct nullifiers, verify `contains` and `len`.
    #[test]
    fun spend_new_nullifier_succeeds() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        let n1 = make_nullifier(1);
        let n2 = make_nullifier(2);

        nr::spend(&mut registry, n1);
        assert!(nr::contains(&registry, &n1) == true);
        assert!(nr::len(&registry) == 1);

        nr::spend(&mut registry, n2);
        assert!(nr::contains(&registry, &n2) == true);
        assert!(nr::len(&registry) == 2);

        // First nullifier is still present.
        assert!(nr::contains(&registry, &n1) == true);

        nr::destroy_test_registry(registry);
    }

    /// Double-spend: inserting the same nullifier twice aborts with
    /// `EAlreadySpent` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun spend_duplicate_aborts() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        let n1 = make_nullifier(42);
        nr::spend(&mut registry, n1);
        // Second spend with the same nullifier — double-spend.
        nr::spend(&mut registry, n1);

        nr::destroy_test_registry(registry);
    }

    /// Spending a zero-length nullifier aborts with `EZeroNullifier` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun spend_zero_nullifier_aborts() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        let empty = vector::empty<u8>();
        nr::spend(&mut registry, empty);

        nr::destroy_test_registry(registry);
    }

    /// Spending a nullifier that is not 32 bytes aborts with
    /// `EInvalidNullifierLength` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun spend_invalid_length_nullifier_aborts() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        // 16-byte nullifier — too short.
        let short = vector[0u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        nr::spend(&mut registry, short);

        nr::destroy_test_registry(registry);
    }

    /// `contains` returns `false` for a nullifier that has not been spent.
    #[test]
    fun contains_false_for_unknown() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        let n1 = make_nullifier(1);
        let n_unknown = make_nullifier(99);

        nr::spend(&mut registry, n1);
        assert!(nr::contains(&registry, &n_unknown) == false);
        assert!(nr::contains(&registry, &n1) == true);
        assert!(nr::len(&registry) == 1);

        nr::destroy_test_registry(registry);
    }

    /// `len` increments correctly.
    #[test]
    fun len_increments() {
        let mut ctx = tx_context::dummy();
        let mut registry = nr::new_test_registry(&mut ctx);

        assert!(nr::len(&registry) == 0);

        nr::spend(&mut registry, make_nullifier(1));
        assert!(nr::len(&registry) == 1);

        nr::spend(&mut registry, make_nullifier(2));
        assert!(nr::len(&registry) == 2);

        nr::spend(&mut registry, make_nullifier(3));
        assert!(nr::len(&registry) == 3);

        nr::destroy_test_registry(registry);
    }
}
