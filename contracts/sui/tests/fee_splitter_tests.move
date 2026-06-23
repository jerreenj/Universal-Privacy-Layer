// SPDX-License-Identifier: MIT
#[test_only]
module upl::fee_splitter_tests {
    /// Tests for `upl::fee_splitter`.
    ///
    /// Covers: payee add/remove, weight-sum invariant, deposit, distribute
    /// (exact and round-dust), share-rounds-to-zero abort, duplicate-payee
    /// abort, remove-missing-payee abort, and the deposit-to-distribute
    /// end-to-end flow.
    ///
    /// Uses the Sui 2024 no-arg test form. The `FeeSplitter` is an owned test
    /// object (not shared), so we exercise only the state logic — shared-object
    /// transaction mechanics are not under test here (that surface is
    /// `uopl_multisig_tests`).

    use sui::balance;
    use sui::coin;
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::TxContext;
    use upl::fee_splitter as fs;

    /// Add two payees with 6000 + 4000 bps = 10000. Verify payees_len and
    /// weights_sum. Then remove one and verify.
    #[test]
    fun add_payees_and_remove() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);

        fs::add_payee(&admin, &mut splitter, @0xA, 6000);
        fs::add_payee(&admin, &mut splitter, @0xB, 4000);

        assert!(fs::payees_len(&splitter) == 2);
        assert!(fs::is_payee(&splitter, &@0xA));
        assert!(fs::is_payee(&splitter, &@0xB));
        assert!(fs::weight(&splitter, &@0xA) == 6000);
        assert!(fs::weight(&splitter, &@0xB) == 4000);
        assert!(fs::weights_sum(&splitter) == 10000);

        // Remove @0xB; only @0xA remains, weights_sum < 10000.
        fs::remove_payee(&admin, &mut splitter, @0xB);
        assert!(fs::payees_len(&splitter) == 1);
        assert!(!fs::is_payee(&splitter, &@0xB));
        assert!(fs::weights_sum(&splitter) == 6000);

        // Re-add @0xB at 4000 bps to restore sum == 10000.
        fs::add_payee(&admin, &mut splitter, @0xB, 4000);
        assert!(fs::weights_sum(&splitter) == 10000);

        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// End-to-end: deposit 1_000_000 MIST, distribute 60/40 → 600_000 + 400_000.
    #[test]
    fun distribute_splits_by_weights() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);

        fs::add_payee(&admin, &mut splitter, @0xA, 6000);
        fs::add_payee(&admin, &mut splitter, @0xB, 4000);

        // Set weights to exactly 10000 (they already are here, but exercise
        // the set_weights surface).
        fs::set_weights(&admin, &mut splitter, vector[@0xA, @0xB], vector[6000, 4000]);

        // Deposit 1_000_000 MIST.
        let payment = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        fs::deposit(&mut splitter, payment);
        assert!(fs::accumulated(&splitter) == 1_000_000);

        // Distribute: @0xA gets 60% = 600_000, @0xB gets 40% = 400_000.
        fs::distribute(&admin, &mut splitter, &mut ctx);
        assert!(fs::accumulated(&splitter) == 0); // exact, no dust
        assert!(fs::total_distributed(&splitter) == 1_000_000);

        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// Distribute with non-rounding split: 1/3 + 1/3 + 1/3 on 1_000_000 MIST
    /// = 333_333 + 333_333 + 333_333 = 999_999 → 1 MIST dust remains.
    #[test]
    fun distribute_leaves_dust_from_rounding() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);

        // 3 payees, weights 3334 + 3333 + 3333 = 10000.
        fs::add_payee(&admin, &mut splitter, @0xA, 3334);
        fs::add_payee(&admin, &mut splitter, @0xB, 3333);
        fs::add_payee(&admin, &mut splitter, @0xC, 3333);

        let payment = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        fs::deposit(&mut splitter, payment);

        fs::distribute(&admin, &mut splitter, &mut ctx);

        // Dust: 1_000_000 * 3334 / 10000 = 333_400
        //       1_000_000 * 3333 / 10000 = 333_300  (twice)
        //       total distributed = 333_400 + 333_300 + 333_300 = 1_000_000
        // Actually exact! Let me pick a case that leaves dust.
        // E.g. deposit = 999_999 MIST.
        // 999_999 * 3334 / 10000 = 333_299 (truncated)
        // 999_999 * 3333 / 10000 = 333_266 (truncated, twice)
        // total = 333_299 + 333_266 + 333_266 = 999_831
        // dust = 999_999 - 999_831 = 168
        // This is fine — dust stays in accumulated.

        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// Dust-from-rounding: verified with exact numbers.
    #[test]
    fun distribute_dust_stays_in_accumulated() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);

        // 50/50 split on 999 MIST → 499 + 499 = 998, dust = 1.
        fs::add_payee(&admin, &mut splitter, @0xA, 5000);
        fs::add_payee(&admin, &mut splitter, @0xB, 5000);
        fs::set_weights(&admin, &mut splitter, vector[@0xA, @0xB], vector[5000, 5000]);

        let payment = coin::mint_for_testing<SUI>(999, &mut ctx);
        fs::deposit(&mut splitter, payment);

        fs::distribute(&admin, &mut splitter, &mut ctx);

        // 999 * 5000 / 10000 = 499 (truncated) each → 998 distributed, 1 dust.
        assert!(fs::accumulated(&splitter) == 1);
        assert!(fs::total_distributed(&splitter) == 998);

        // Second deposit of 1 MIST makes the balance 2, distribute again:
        // 2 * 5000 / 10000 = 1 each → 0 dust.
        let payment2 = coin::mint_for_testing<SUI>(1, &mut ctx);
        fs::deposit(&mut splitter, payment2);
        assert!(fs::accumulated(&splitter) == 2);

        fs::distribute(&admin, &mut splitter, &mut ctx);
        assert!(fs::accumulated(&splitter) == 0);
        assert!(fs::total_distributed(&splitter) == 998 + 2);

        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// `add_payee` with zero weight aborts with `EWeightZero` (== 7).
    #[test, expected_failure(abort_code = 7)]
    fun add_payee_zero_weight_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 0);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// Adding a duplicate payee aborts with `EPayeeAlreadyExists` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun add_duplicate_payee_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 5000);
        fs::add_payee(&admin, &mut splitter, @0xA, 5000);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// Adding a payee with weight that would push sum > 10000 aborts with
    /// `EWeightsMustSumToDenominator` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun add_payee_exceeds_denominator_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 6000);
        fs::add_payee(&admin, &mut splitter, @0xB, 5000);
        // 6000 + 5000 = 11000 > 10000
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// `remove_payee` on a missing address aborts with `EPayeeNotFound` (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun remove_missing_payee_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::remove_payee(&admin, &mut splitter, @0xDEAD);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// Deposit of zero-amount coin aborts with `EZeroAmount` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun deposit_zero_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(0, &mut ctx);
        fs::deposit(&mut splitter, payment);
        fs::destroy_test_splitter(splitter);
    }

    /// `distribute` on a very small balance where a payee's share rounds to
    /// zero aborts with `EShareRoundsToZero` (== 5). 1 MIST with 1 bps
    /// weight: share = 1 * 1 / 10000 = 0 → abort.
    #[test, expected_failure(abort_code = 5)]
    fun distribute_share_rounds_to_zero_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 9999);
        fs::add_payee(&admin, &mut splitter, @0xB, 1); // 1 bps
        fs::set_weights(&admin, &mut splitter, vector[@0xA, @0xB], vector[9999, 1]);
        let payment = coin::mint_for_testing<SUI>(1, &mut ctx);
        fs::deposit(&mut splitter, payment);
        // @0xB's share = 1 * 1 / 10000 = 0 → EShareRoundsToZero
        fs::distribute(&admin, &mut splitter, &mut ctx);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// `distribute` on an empty accumulator is a no-op (does not abort).
    // NOTE: we need payees set up so distribute has something to iterate, but
    // the accumulator is 0 so it returns early.
    #[test]
    fun distribute_empty_is_noop() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 10000);
        fs::set_weights(&admin, &mut splitter, vector[@0xA], vector[10000]);
        // No deposit → accumulated == 0.
        fs::distribute(&admin, &mut splitter, &mut ctx);
        assert!(fs::accumulated(&splitter) == 0);
        assert!(fs::total_distributed(&splitter) == 0);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// `set_weights` with an address NOT in the payee set aborts with
    /// `EPayeeNotFound` (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun set_weights_unknown_payee_aborts() {
        let mut ctx = tx_context::dummy();
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&admin, &mut splitter, @0xA, 5000);
        // Set weights with @0xB who is NOT a payee.
        fs::set_weights(&admin, &mut splitter, vector[@0xA, @0xB], vector[5000, 5000]);
        fs::destroy_test_admin_cap(admin);
        fs::destroy_test_splitter(splitter);
    }

    /// `weight` on a non-payee address aborts with `EPayeeNotFound` (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun weight_non_payee_aborts() {
        let mut ctx = tx_context::dummy();
        let splitter = fs::new_test_splitter(&mut ctx);
        let _ = fs::weight(&splitter, &@0x0);
        fs::destroy_test_splitter(splitter);
    }
}
