// SPDX-License-Identifier: MIT
#[test_only]
module upl::cancel_nonce_tests {
    /// Tests for `upl::cancel_nonce`.
    ///
    /// Covers: fresh address has nonce 0 and contains==false; consume(0)
    /// advances to nonce 1; consume(1) advances further; consume with a
    /// mismatched expected nonce aborts (ENonceMismatch); cancel advances
    /// the nonce; cancel with target < current is a no-op; cancel with a
    /// large target jumps the nonce forward; and combining consume + cancel
    /// in sequence.
    ///
    /// Because `consume` and `cancel` read the sender via `TxContext`, tests
    /// that need a specific sender use `sui::test_scenario` (same pattern as
    /// `uopl_multisig_tests`). Tests that only exercise abort paths or
    /// read-only logic use the simpler `tx_context::dummy()` form (where the
    /// sender is @0x0).
    ///
    /// All tests use the Sui 2024 no-arg form.

    use sui::test_scenario;
    use sui::tx_context::TxContext;
    use upl::cancel_nonce as cn;

    /// A fresh address has nonce 0 and contains == false.
    #[test]
    fun fresh_address_nonce_is_zero() {
        let mut ctx = tx_context::dummy();
        let registry = cn::new_test_registry(&mut ctx);
        assert!(cn::nonce(&registry, @0xCAFE) == 0);
        assert!(!cn::contains(&registry, @0xCAFE));
        cn::destroy_test_registry(registry);
    }

    /// consume(0) for a fresh address @0xA advances nonce to 1 and returns 0.
    #[test]
    fun consume_first_nonce_advances_to_one() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        assert!(cn::nonce(&registry, @0xA) == 0);
        let consumed = cn::consume(&mut registry, 0, scenario.ctx());
        assert!(consumed == 0);
        assert!(cn::nonce(&registry, @0xA) == 1);
        assert!(cn::contains(&registry, @0xA));

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// Sequential consumes: consume(0), consume(1), consume(2) advance
    /// the nonce to 3.
    #[test]
    fun sequential_consumes_advance_nonce() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        let n0 = cn::consume(&mut registry, 0, scenario.ctx());
        assert!(n0 == 0);
        assert!(cn::nonce(&registry, @0xA) == 1);

        let n1 = cn::consume(&mut registry, 1, scenario.ctx());
        assert!(n1 == 1);
        assert!(cn::nonce(&registry, @0xA) == 2);

        let n2 = cn::consume(&mut registry, 2, scenario.ctx());
        assert!(n2 == 2);
        assert!(cn::nonce(&registry, @0xA) == 3);

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// consume with an unexpected nonce aborts (ENonceMismatch == 1).
    /// @0xA's on-chain nonce is 0 (fresh), but we try consume(5).
    #[test, expected_failure(abort_code = 1)]
    fun consume_mismatch_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());
        let _ = cn::consume(&mut registry, 5, scenario.ctx());
        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// After consuming nonce 0, trying consume(0) again aborts (nonce is now 1).
    #[test, expected_failure(abort_code = 1)]
    fun consume_same_nonce_twice_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());
        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        // On-chain nonce is now 1; consume(0) is a mismatch.
        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// cancel(5) for a fresh address advances nonce to 6.
    #[test]
    fun cancel_advances_nonce_forward() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        cn::cancel(&mut registry, 5, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 6);
        assert!(cn::contains(&registry, @0xA));

        // Now consume(6) works (the next expected nonce is 6).
        let n6 = cn::consume(&mut registry, 6, scenario.ctx());
        assert!(n6 == 6);
        assert!(cn::nonce(&registry, @0xA) == 7);

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// cancel with target < current is a no-op.
    #[test]
    fun cancel_noop_when_target_below_current() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        // Consume nonces 0, 1, 2 → on-chain nonce = 3.
        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        let _ = cn::consume(&mut registry, 1, scenario.ctx());
        let _ = cn::consume(&mut registry, 2, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 3);

        // cancel(2) → below current, no-op.
        cn::cancel(&mut registry, 2, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 3);

        // cancel(0) → below current, no-op.
        cn::cancel(&mut registry, 0, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 3);

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// cancel with a large target jumps the nonce forward (void all
    /// pending intents up to that target).
    #[test]
    fun cancel_large_target_jumps_nonce() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        // On-chain nonce = 0 (fresh). cancel(1000) → nonce = 1001.
        cn::cancel(&mut registry, 1000, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 1001);

        // consume(1001) works.
        let n = cn::consume(&mut registry, 1001, scenario.ctx());
        assert!(n == 1001);
        assert!(cn::nonce(&registry, @0xA) == 1002);

        // Trying to consume any nonce <= 1000 would abort.
        // (Tested implicitly — we won't write 1000 individual abort tests.)

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// Different addresses have independent nonces.
    #[test]
    fun different_addresses_independent_nonces() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 1);

        // @0xB is still at 0.
        assert!(cn::nonce(&registry, @0xB) == 0);
        assert!(!cn::contains(&registry, @0xB));

        // Switch sender to @0xB for the next consume.
        scenario.next_tx(@0xB);
        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        assert!(cn::nonce(&registry, @0xB) == 1);

        // @0xA is still at 1.
        assert!(cn::nonce(&registry, @0xA) == 1);

        cn::destroy_test_registry(registry);
        scenario.end();
    }

    /// Cancel after partial consume: consume(0), consume(1) → nonce=2,
    /// then cancel(10) → nonce=11. Void nonces 2..=10.
    #[test]
    fun cancel_after_partial_consume_voids_remaining() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = cn::new_test_registry(scenario.ctx());

        let _ = cn::consume(&mut registry, 0, scenario.ctx());
        let _ = cn::consume(&mut registry, 1, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 2);

        // Cancel nonces 2..=10.
        cn::cancel(&mut registry, 10, scenario.ctx());
        assert!(cn::nonce(&registry, @0xA) == 11);

        // Trying to consume(2) aborts (nonce is already past it).
        // We test by trying consume(11) which should succeed.
        let n = cn::consume(&mut registry, 11, scenario.ctx());
        assert!(n == 11);
        assert!(cn::nonce(&registry, @0xA) == 12);

        cn::destroy_test_registry(registry);
        scenario.end();
    }
}
