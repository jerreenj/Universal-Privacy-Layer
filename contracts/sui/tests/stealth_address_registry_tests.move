// SPDX-License-Identifier: MIT
#[test_only]
module upl::stealth_address_registry_tests {
    /// Tests for `upl::stealth_address_registry`.
    ///
    /// These run under `sui move test` with a synthetic `TxContext` built via
    /// `tx_context::dummy()` (the Sui 2024 convention — tests take no args; the
    /// `native_sender` backing `tx_context::sender` is `@0x0` under the dummy
    /// context). Reads/writes go through the real `table`/`object`/`event`
    /// framework, so each test exercises the production code path including the
    /// dynamic-field table backing for the registry index.

    use sui::clock;
    use sui::tx_context::TxContext;
    use upl::stealth_address_registry as reg;

    /// Owned unit-test clock pinned to a fixed timestamp. Held owned (NOT
    /// shared — sharing is for transactional tests; here we pass `&clock`
    /// directly to the entry-under-test).
    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 1_700_000_000_000);
        c
    }

    /// Round-trip a single announcement: announce -> count==1, the field
    /// getters return what we put in, and a get-by-id borrow matches.
    #[test]
    fun round_trip_single_announcement() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);

        // Pre-state: empty.
        assert!(reg::announcement_count(&registry) == 0);

        reg::announce(
            &mut ctx,
            &mut registry,
            x"1122334455667788",
            x"ab",
            x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef11",
            &clock,
        );

        assert!(reg::announcement_count(&registry) == 1);

        let a = reg::get_announcement(&registry, 0);
        assert!(*reg::ephemeral_pub_key(a) == x"1122334455667788");
        assert!(*reg::view_tag(a) == x"ab");
        assert!(*reg::stealth_hash(a) == x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef11");
        assert!(reg::timestamp_ms(a) == 1_700_000_000_000);

        // View-tag index resolves the same id we just inserted.
        let mut id_opt = reg::id_for_view_tag(&registry, x"ab");
        assert!(id_opt.is_some());
        assert!(id_opt.extract() == 0);

        reg::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// First-write-wins: a repeated view_tag keeps the *original* id bound in
    /// the index, but the new record still gets a fresh sequential id and is
    /// reachable by id.
    #[test]
    fun first_write_wins_on_view_tag() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        reg::announce(&mut ctx, &mut registry, x"11", x"ab", x"01", &clock);
        reg::announce(&mut ctx, &mut registry, x"22", x"ab", x"02", &clock);
        reg::announce(&mut ctx, &mut registry, x"33", x"cd", x"03", &clock);

        assert!(reg::announcement_count(&registry) == 3);

        // The "ab" index still points at id 0 (first insertion).
        let ab_id = reg::id_for_view_tag_or_abort(&registry, x"ab");
        assert!(ab_id == 0);

        // "cd" was inserted fresh and binds to id 2.
        let cd_id = reg::id_for_view_tag_or_abort(&registry, x"cd");
        assert!(cd_id == 2);

        // An unknown tag gives `none`.
        let absent = reg::id_for_view_tag(&registry, x"ff");
        assert!(absent.is_none());
        let _ = absent;

        // But id 1 is still retrievable directly (first-write-wins only
        // affects the index, not the append-only log).
        let dup = reg::get_announcement(&registry, 1);
        assert!(*reg::ephemeral_pub_key(dup) == x"22");

        reg::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Empty `ephemeral_pub_key` aborts with `EEmptyEphemeralPubKey` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun rejects_empty_ephemeral_key() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        reg::announce(&mut ctx, &mut registry, x"", x"ab", x"01", &clock);
        reg::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// Empty `view_tag` aborts with `EEmptyViewTag` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun rejects_empty_view_tag() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        reg::announce(&mut ctx, &mut registry, x"11", x"", x"01", &clock);
        reg::destroy_test_registry(registry);
        clock::destroy_for_testing(clock);
    }

    /// `get_announcement` for a missing id aborts with `EAnnouncementNotFound` (== 3).
    ///
    /// The abort fires mid-call; the cleanup lines after only execute on the
    /// non-abort path — i.e. only if this test is *wrong* (the call unexpectedly
    /// succeeds), which makes the leak-check correctly fail and surface the
    /// regression rather than silently passing on a swallowed abort.
    #[test, expected_failure(abort_code = 3)]
    fun get_missing_id_aborts() {
        let mut ctx = tx_context::dummy();
        let registry = reg::new_test_registry(&mut ctx);
        let _ = reg::get_announcement(&registry, 42);
        reg::destroy_test_registry(registry);
    }

    /// `id_for_view_tag_or_abort` for an unregistered tag aborts (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun id_for_unknown_tag_aborts() {
        let mut ctx = tx_context::dummy();
        let registry = reg::new_test_registry(&mut ctx);
        let _ = reg::id_for_view_tag_or_abort(&registry, x"ee");
        reg::destroy_test_registry(registry);
    }
}
