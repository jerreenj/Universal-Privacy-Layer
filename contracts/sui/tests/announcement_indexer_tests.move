// SPDX-License-Identifier: MIT
#[test_only]
module upl::announcement_indexer_tests {
    /// Tests for `upl::announcement_indexer`.
    ///
    /// Covers: cursor starts at 0; advance_cursor moves it forward;
    /// advance_cursor backwards aborts; advance_cursor no-op when same;
    /// scan returns the right id ranges; scan on empty (hwm=0) returns
    /// empty; scan with limit > remaining returns only what's available;
    /// scan with limit > MAX_PAGE is clamped; scan with after_id >= hwm
    /// returns empty; scan with limit=0 aborts.
    ///
    /// All tests use the Sui 2024 no-arg form.

    use sui::tx_context::TxContext;
    use std::vector;
    use upl::announcement_indexer as idx;

    /// Fresh indexer starts at hwm=0.
    #[test]
    fun fresh_indexer_high_water_mark_is_zero() {
        let mut ctx = tx_context::dummy();
        let indexer = idx::new_test_indexer(&mut ctx);
        assert!(idx::high_water_mark(&indexer) == 0);
        idx::destroy_test_indexer(indexer);
    }

    /// advance_cursor moves the high-water mark forward and emits
    /// CursorAdvanced.
    #[test]
    fun advance_cursor_moves_forward() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 10);
        assert!(idx::high_water_mark(&indexer) == 10);
        idx::advance_cursor(&mut indexer, 25);
        assert!(idx::high_water_mark(&indexer) == 25);
        idx::destroy_test_indexer(indexer);
    }

    /// advance_cursor with new_mark == current hwm is a no-op.
    #[test]
    fun advance_cursor_noop_on_same_mark() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 10);
        idx::advance_cursor(&mut indexer, 10); // no-op
        assert!(idx::high_water_mark(&indexer) == 10);
        idx::destroy_test_indexer(indexer);
    }

    /// advance_cursor with new_mark < hwm aborts (ECursorWouldRegress == 1).
    #[test, expected_failure(abort_code = 1)]
    fun advance_cursor_regress_aborts() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 10);
        idx::advance_cursor(&mut indexer, 5);
        idx::destroy_test_indexer(indexer);
    }

    /// scan from after_id=0 with hwm=5, limit=10 returns ids [1,2,3,4,5].
    #[test]
    fun scan_returns_ids_from_after_id_to_hwm() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 5);

        let page = idx::scan(&indexer, 0, 10);
        assert!(page.length() == 5);
        assert!(*page.borrow(0) == 1);
        assert!(*page.borrow(1) == 2);
        assert!(*page.borrow(2) == 3);
        assert!(*page.borrow(3) == 4);
        assert!(*page.borrow(4) == 5);

        idx::destroy_test_indexer(indexer);
    }

    /// scan with after_id > 0 returns only ids after the cursor.
    #[test]
    fun scan_from_mid_cursor() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 100);

        // after_id=90, limit=10 → ids [91..100].
        let page = idx::scan(&indexer, 90, 10);
        assert!(page.length() == 10);
        assert!(*page.borrow(0) == 91);
        assert!(*page.borrow(9) == 100);

        // Continue from 100 → empty (at end).
        let page2 = idx::scan(&indexer, 100, 10);
        assert!(page2.is_empty());

        idx::destroy_test_indexer(indexer);
    }

    /// scan on empty indexer (hwm=0) returns an empty vector (not an abort).
    #[test]
    fun scan_empty_indexer_returns_empty() {
        let mut ctx = tx_context::dummy();
        let indexer = idx::new_test_indexer(&mut ctx);
        let page = idx::scan(&indexer, 0, 10);
        assert!(page.is_empty());
        idx::destroy_test_indexer(indexer);
    }

    /// scan with limit > remaining returns only the remaining ids.
    #[test]
    fun scan_limit_larger_than_remaining() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 3);

        // after_id=0, limit=100 → only 3 ids.
        let page = idx::scan(&indexer, 0, 100);
        assert!(page.length() == 3);
        assert!(*page.borrow(0) == 1);
        assert!(*page.borrow(2) == 3);

        idx::destroy_test_indexer(indexer);
    }

    /// scan with after_id >= hwm returns empty (nothing new to scan).
    #[test]
    fun scan_after_id_ge_hwm_returns_empty() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 5);

        // after_id == hwm → empty.
        let p1 = idx::scan(&indexer, 5, 10);
        assert!(p1.is_empty());

        // after_id > hwm → empty.
        let p2 = idx::scan(&indexer, 999, 10);
        assert!(p2.is_empty());

        idx::destroy_test_indexer(indexer);
    }

    /// scan with limit > MAX_PAGE is clamped.
    #[test]
    fun scan_limit_clamped_to_max_page() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 300);

        // limit=1000 → clamped to 256, returns 256 ids.
        let page = idx::scan(&indexer, 0, 1000);
        assert!(page.length() == 256);
        assert!(*page.borrow(0) == 1);
        assert!(*page.borrow(255) == 256);

        // Continue from 256 → 44 remaining.
        let page2 = idx::scan(&indexer, 256, 1000);
        assert!(page2.length() == 44);
        assert!(*page2.borrow(0) == 257);
        assert!(*page2.borrow(43) == 300);

        idx::destroy_test_indexer(indexer);
    }

    /// scan with limit == 0 aborts with `ELimitZero` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun scan_limit_zero_aborts() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 10);
        let _ = idx::scan(&indexer, 0, 0);
        idx::destroy_test_indexer(indexer);
    }

    /// Multi-page cursor iteration: advance cursor to 21, then scan 5+5+5+5+1.
    #[test]
    fun multi_page_cursor_scan() {
        let mut ctx = tx_context::dummy();
        let mut indexer = idx::new_test_indexer(&mut ctx);
        idx::advance_cursor(&mut indexer, 21);

        let mut after = 0;
        let mut all_ids = vector::empty<u64>();

        // Page 1
        let p1 = idx::scan(&indexer, after, 5);
        assert!(p1.length() == 5);
        let mut i = 0;
        while (i < p1.length()) {
            vector::push_back(&mut all_ids, *p1.borrow(i));
            i = i + 1;
        };
        after = *p1.borrow(4);

        // Page 2
        let p2 = idx::scan(&indexer, after, 5);
        assert!(p2.length() == 5);
        i = 0;
        while (i < p2.length()) {
            vector::push_back(&mut all_ids, *p2.borrow(i));
            i = i + 1;
        };
        after = *p2.borrow(4);

        // Page 3
        let p3 = idx::scan(&indexer, after, 5);
        assert!(p3.length() == 5);
        i = 0;
        while (i < p3.length()) {
            vector::push_back(&mut all_ids, *p3.borrow(i));
            i = i + 1;
        };
        after = *p3.borrow(4);

        // Page 4
        let p4 = idx::scan(&indexer, after, 5);
        assert!(p4.length() == 5);
        i = 0;
        while (i < p4.length()) {
            vector::push_back(&mut all_ids, *p4.borrow(i));
            i = i + 1;
        };
        after = *p4.borrow(4);

        // Page 5 — only 1 id left.
        let p5 = idx::scan(&indexer, after, 5);
        assert!(p5.length() == 1);
        i = 0;
        while (i < p5.length()) {
            vector::push_back(&mut all_ids, *p5.borrow(i));
            i = i + 1;
        };

        // Verify all 21 ids.
        assert!(all_ids.length() == 21);
        i = 0;
        while (i < 21) {
            assert!(*all_ids.borrow(i) == (i + 1));
            i = i + 1;
        };

        idx::destroy_test_indexer(indexer);
    }
}
