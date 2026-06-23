// SPDX-License-Identifier: MIT
#[test_only]
module upl::relayer_registry_tests {
    /// Tests for `upl::relayer_registry`.
    ///
    /// Covers: approve a new relayer (total_registered, active_count, info
    /// fields all correct); approve duplicate aborts; deactivate an active
    /// relayer (active_count drops, info.active flips); deactivate already
    /// inactive aborts; reactivate a deactivated relayer; reactivate already
    /// active aborts; update_endpoint changes the hash; endpoint_hash /
    /// registered_at_ms reads; read on missing relayer aborts; is_registered
    /// / is_active work for all states; relayer_info returns None for unknown.
    ///
    /// All tests use the Sui 2024 no-arg form.

    use sui::clock;
    use sui::tx_context::TxContext;
    use upl::relayer_registry as rr;

    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 7_000_000_000_000);
        c
    }

    /// Approve a new relayer: counters, info fields, and is_active all
    /// reflect the new entry.
    #[test]
    fun approve_new_relayer() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        rr::approve(&admin, &mut registry, @0xA, x"ab", &clock);

        assert!(rr::total_registered(&registry) == 1);
        assert!(rr::active_count(&registry) == 1);
        assert!(rr::is_registered(&registry, @0xA));
        assert!(rr::is_active(&registry, @0xA));
        assert!(rr::endpoint_hash(&registry, @0xA) == x"ab");
        assert!(rr::registered_at_ms(&registry, @0xA) == 7_000_000_000_000);

        // Unknown relayer → not registered, not active.
        assert!(!rr::is_registered(&registry, @0xB));
        assert!(!rr::is_active(&registry, @0xB));

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Approve two relayers: both appear, both active.
    #[test]
    fun approve_multiple_relayers() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::approve(&admin, &mut registry, @0xB, x"bb", &clock);

        assert!(rr::total_registered(&registry) == 2);
        assert!(rr::active_count(&registry) == 2);
        assert!(rr::is_active(&registry, @0xA));
        assert!(rr::is_active(&registry, @0xB));

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Approve duplicate address aborts with `EAlreadyRegistered` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun approve_duplicate_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::approve(&admin, &mut registry, @0xA, x"bb", &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Approve zero address aborts with `EZeroRelayer` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun approve_zero_address_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0x0, x"aa", &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Approve with empty endpoint hash aborts with `EEmptyEndpointHash` (== 7).
    #[test, expected_failure(abort_code = 7)]
    fun approve_empty_endpoint_hash_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0xA, x"", &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Deactivate an active relayer: active_count drops, is_active goes false.
    #[test]
    fun deactivate_active_relayer() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::approve(&admin, &mut registry, @0xB, x"bb", &clock);
        assert!(rr::active_count(&registry) == 2);

        rr::deactivate(&admin, &mut registry, @0xA, &clock);

        assert!(rr::active_count(&registry) == 1);
        assert!(!rr::is_active(&registry, @0xA));
        assert!(rr::is_registered(&registry, @0xA)); // still registered
        assert!(rr::is_active(&registry, @0xB));

        // The RelayerInfo is still retrievable.
        let info = rr::relayer_info(&registry, @0xA);
        let mut opt = info;
        assert!(opt.is_some());
        let ri = opt.extract();
        assert!(!rr::info_active(&ri));
        assert!(rr::info_last_status_change_ms(&ri) == 7_000_000_000_000);

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Deactivate an already-inactive relayer aborts with `EAlreadyInactive`
    /// (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun deactivate_already_inactive_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::deactivate(&admin, &mut registry, @0xA, &clock);
        rr::deactivate(&admin, &mut registry, @0xA, &clock); // already inactive
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Deactivate a missing address aborts with `ENotRegistered` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun deactivate_missing_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::deactivate(&admin, &mut registry, @0xDEAD, &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Reactivate a deactivated relayer: active_count grows again,
    /// is_active goes back to true.
    #[test]
    fun reactivate_deactivated_relayer() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::deactivate(&admin, &mut registry, @0xA, &clock);
        assert!(rr::active_count(&registry) == 0);
        assert!(!rr::is_active(&registry, @0xA));

        rr::reactivate(&admin, &mut registry, @0xA, &clock);

        assert!(rr::active_count(&registry) == 1);
        assert!(rr::is_active(&registry, @0xA));

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Reactivate an already-active relayer aborts with `EAlreadyActive`
    /// (== 5).
    #[test, expected_failure(abort_code = 5)]
    fun reactivate_already_active_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::reactivate(&admin, &mut registry, @0xA, &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Reactivate a never-registered address aborts with
    /// `ENotRegisteredForReactivate` (== 6).
    #[test, expected_failure(abort_code = 6)]
    fun reactivate_never_registered_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::reactivate(&admin, &mut registry, @0xDEAD, &clock);
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// `update_endpoint` changes the hash; the old hash is gone.
    #[test]
    fun update_endpoint_changes_hash() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        rr::approve(&admin, &mut registry, @0xA, x"old", &clock);
        assert!(rr::endpoint_hash(&registry, @0xA) == x"old");

        rr::update_endpoint(&admin, &mut registry, @0xA, x"new");
        assert!(rr::endpoint_hash(&registry, @0xA) == x"new");

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// `update_endpoint` for a missing relayer aborts with `ENotRegistered`
    /// (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun update_endpoint_missing_aborts() {
        let mut ctx = tx_context::dummy();
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::update_endpoint(&admin, &mut registry, @0xDEAD, x"new");
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
    }

    /// `update_endpoint` with empty hash aborts with `EEmptyEndpointHash` (== 7).
    #[test, expected_failure(abort_code = 7)]
    fun update_endpoint_empty_hash_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);
        rr::approve(&admin, &mut registry, @0xA, x"aa", &clock);
        rr::update_endpoint(&admin, &mut registry, @0xA, x"");
        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// `endpoint_hash` for a missing address aborts with `ENotRegistered`
    /// (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun endpoint_hash_missing_aborts() {
        let mut ctx = tx_context::dummy();
        let registry = rr::new_test_registry(&mut ctx);
        let _ = rr::endpoint_hash(&registry, @0xDEAD);
        rr::destroy_test_registry(registry);
    }

    /// `relayer_info` returns None for an unknown address.
    #[test]
    fun relayer_info_returns_none_for_unknown() {
        let mut ctx = tx_context::dummy();
        let registry = rr::new_test_registry(&mut ctx);
        let result = rr::relayer_info(&registry, @0xDEAD);
        assert!(result.is_none());
        rr::destroy_test_registry(registry);
    }

    /// Full lifecycle: approve → deactivate → reactivate → update_endpoint.
    #[test]
    fun full_lifecycle() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = rr::new_test_registry(&mut ctx);
        let admin = rr::new_test_admin_cap(&mut ctx);

        // Approve
        rr::approve(&admin, &mut registry, @0xA, x"v1", &clock);
        assert!(rr::active_count(&registry) == 1);
        assert!(rr::total_registered(&registry) == 1);

        // Deactivate
        rr::deactivate(&admin, &mut registry, @0xA, &clock);
        assert!(rr::active_count(&registry) == 0);
        assert!(!rr::is_active(&registry, @0xA));
        // total_registered stays at 1 (it's monotonic, not active-count).
        assert!(rr::total_registered(&registry) == 1);

        // Reactivate
        rr::reactivate(&admin, &mut registry, @0xA, &clock);
        assert!(rr::active_count(&registry) == 1);
        assert!(rr::is_active(&registry, @0xA));

        // Update endpoint
        rr::update_endpoint(&admin, &mut registry, @0xA, x"v2");
        assert!(rr::endpoint_hash(&registry, @0xA) == x"v2");

        rr::destroy_test_admin_cap(admin);
        rr::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }
}
