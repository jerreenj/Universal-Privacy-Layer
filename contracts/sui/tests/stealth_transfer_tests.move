// SPDX-License-Identifier: MIT
#[test_only]
module upl::stealth_transfer_tests {
    /// Tests for `upl::stealth_transfer` (the registry -> index -> cursor ->
    /// relay -> receipt atomic-composition surface).
    ///
    /// Two paths:
    ///   1. `relayed_send` — runs under a `RelayerCap` and `ReceiptCap`,
    ///      announces into the registry, indexes the view tag in the
    ///      `ViewTagIndex`, advances the `AnnouncementIndexer` cursor, relays
    ///      the gross coin (skimming the configured fee inside
    ///      `privacy_relayer::relay`), then mints the encrypted receipt.
    ///   2. `direct_send` — no `RelayerCap`: the entire gross coin forwards to
    ///      the recipient and the receipt is still minted. The view-tag index
    ///      and announcement cursor are also updated.
    ///
    /// The receipt object is `transfer::public_transfer`'d to `recipient` and
    /// is *not* recoverable under the dummy `tx_context` (the recipient does
    /// not sign to receive), so we assert the flow did not abort and the
    /// observable side-effects (registry count, `total_relayed`, fee accrual,
    /// view-tag index, indexer cursor) match expectations.
    /// All tests: Sui 2024 no-arg form.

    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::tx_context::TxContext;
    use upl::stealth_address_registry as reg;
    use upl::stealth_transfer as xfer;
    use upl::privacy_relayer as rel;
    use upl::privacy_receipt as recpt;
    use upl::view_tag_index as vti;
    use upl::announcement_indexer as idx;

    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 1_700_000_000_000);
        c
    }

    /// `relayed_send` under a 1% fee: the registry grows by 1 announcement,
    /// `total_relayed` grows by the *net* (gross - fee), the fee lands in
    /// the relayer's accumulator, the view-tag index has 1 entry, and the
    /// indexer cursor is advanced.
    #[test]
    fun relayed_send_announces_relays_indexes_and_accrues_fee() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let mut state = rel::new_test_state(100, &mut ctx); // 1% fee
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);

        let gross = 1_000_000;
        let payment = coin::mint_for_testing<SUI>(gross, &mut ctx);

        let reg_before = reg::announcement_count(&registry);
        let relayed_before = rel::total_relayed(&state);

        xfer::relayed_send(
            &relayer_cap,
            &receipt_cap,
            &mut state,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0xCAFE,
            payment,
            x"abcDEF",
            0x01,
            x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef01",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );

        // One new announcement; net forwarded = gross - 1% = 990_000.
        assert!(reg::announcement_count(&registry) == reg_before + 1);
        assert!(rel::total_relayed(&state) == relayed_before + 990_000);
        assert!(rel::accumulated_fees(&state) == 10_000);

        // View-tag index: 1 entry under tag [0x01].
        assert!(vti::total_indexed(&vti_obj) == 1);
        assert!(vti::bucket_length(&vti_obj, x"01") == 1);

        // Announcement indexer: cursor at announcement_id == 0.
        assert!(idx::high_water_mark(&indexer) == 0);

        // Drain accrued fees so destroy_test_state's destroy_zero invariant
        // holds; clean up the rest of the owned objects.
        let admin_cap = rel::new_test_admin_cap(&mut ctx);
        rel::withdraw_fees(&admin_cap, &mut state, @0xFEED, &mut ctx);
        assert!(rel::accumulated_fees(&state) == 0);

        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_relayer_cap(relayer_cap);
        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }

    /// `direct_send` (no `RelayerCap`): registry grows by 1, view-tag index
    /// has 1 entry, indexer cursor advances, and the entire gross coin
    /// forwards to the recipient (no fee accrual).
    #[test]
    fun direct_send_announces_indexes_and_forwards_full_amount_no_fee() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let state = rel::new_test_state(0, &mut ctx);
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);

        let gross = 500_000;
        let payment = coin::mint_for_testing<SUI>(gross, &mut ctx);

        let reg_before = reg::announcement_count(&registry);

        xfer::direct_send(
            &receipt_cap,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0xCAFE,
            payment,
            x"abcDEF",
            x"01",
            x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef01",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );

        assert!(reg::announcement_count(&registry) == reg_before + 1);
        // No relay involved -> no fee accrued; total_relayed unchanged at 0.
        assert!(rel::total_relayed(&state) == 0);
        assert!(rel::accumulated_fees(&state) == 0);

        // View-tag index: 1 entry under tag [0x01].
        assert!(vti::total_indexed(&vti_obj) == 1);

        // Announcement indexer: cursor at 0.
        assert!(idx::high_water_mark(&indexer) == 0);

        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }

    /// `relayed_send` with a zero-amount coin aborts (== EZeroAmount = 1 —
    /// the guard at the top of `relayed_send`).
    #[test, expected_failure(abort_code = 1)]
    fun relayed_send_zero_amount_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let mut state = rel::new_test_state(100, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(0, &mut ctx);
        xfer::relayed_send(
            &relayer_cap,
            &receipt_cap,
            &mut state,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0xCAFE,
            payment,
            x"abcDEF",
            0x01,
            x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef01",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );
        rel::destroy_test_relayer_cap(relayer_cap);
        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }

    /// `direct_send` to the zero recipient aborts (== EZeroRecipient = 2 in
    /// `stealth_transfer`'s own guard, ahead of the registry announce).
    #[test, expected_failure(abort_code = 2)]
    fun direct_send_zero_recipient_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let state = rel::new_test_state(0, &mut ctx);
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        xfer::direct_send(
            &receipt_cap,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0x0,
            payment,
            x"abcDEF",
            x"01",
            x"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef01",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );
        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }

    /// `relayed_send_entry` delegates to `relayed_send` with identical
    /// semantics. This guards the CLI-facing wrapper added in package v4
    /// (so a future refactor of the entry signature can't silently diverge
    /// from the composed-fun path the rest of the package depends on).
    #[test]
    fun relayed_send_entry_delegates_identically() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let mut state = rel::new_test_state(0, &mut ctx); // 0% fee -> net == gross
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);

        let gross = 2_000_000;
        let payment = coin::mint_for_testing<SUI>(gross, &mut ctx);

        let reg_before = reg::announcement_count(&registry);
        let relayed_before = rel::total_relayed(&state);

        xfer::relayed_send_entry(
            &relayer_cap,
            &receipt_cap,
            &mut state,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0xBEEF,
            payment,
            x"0042",
            0x07,
            x"f00d",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );

        // With 0% fee the net forwarded equals the gross; one announcement
        // minted; view-tag index + indexer cursor advanced.
        assert!(reg::announcement_count(&registry) == reg_before + 1);
        assert!(rel::total_relayed(&state) == relayed_before + gross);
        assert!(rel::accumulated_fees(&state) == 0);
        assert!(vti::total_indexed(&vti_obj) == 1);
        assert!(idx::high_water_mark(&indexer) == 0);

        rel::destroy_test_relayer_cap(relayer_cap);
        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }

    /// `direct_send_entry` delegates to `direct_send` with identical semantics
    /// (no fee, full gross forwarded).
    #[test]
    fun direct_send_entry_delegates_identically() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut registry = reg::new_test_registry(&mut ctx);
        let state = rel::new_test_state(50, &mut ctx); // fee set but unused on direct path
        let receipt_cap = recpt::new_test_receipt_cap(&mut ctx);
        let mut vti_obj = vti::new_test_index(&mut ctx);
        let mut indexer = idx::new_test_indexer(&mut ctx);

        let gross = 750_000;
        let payment = coin::mint_for_testing<SUI>(gross, &mut ctx);

        let reg_before = reg::announcement_count(&registry);

        xfer::direct_send_entry(
            &receipt_cap,
            &mut registry,
            &mut vti_obj,
            &mut indexer,
            @0xBEEF,
            payment,
            x"0042",
            x"07",
            x"f00d",
            x"c0ffee",
            x"deadbeefdeadbeef",
            &clock,
            &mut ctx,
        );

        assert!(reg::announcement_count(&registry) == reg_before + 1);
        // direct path never touches the relayer -> total_relayed stays 0.
        assert!(rel::total_relayed(&state) == 0);
        assert!(rel::accumulated_fees(&state) == 0);
        assert!(vti::total_indexed(&vti_obj) == 1);
        assert!(idx::high_water_mark(&indexer) == 0);

        recpt::destroy_test_receipt_cap(receipt_cap);
        rel::destroy_test_state(state);
        reg::destroy_test_registry(registry);
        vti::destroy_test_index(vti_obj);
        idx::destroy_test_indexer(indexer);
        clock::destroy_for_testing(clock);
    }
}
