// SPDX-License-Identifier: MIT
#[test_only]
module upl::view_tag_index_tests {
    /// Tests for `upl::view_tag_index`.
    ///
    /// Covers: single-record creates the bucket and sets total_indexed;
    /// multi-record across the same and different tags appends into the correct
    /// bucket; `page` first page, mid-bucket page, and past-end page all return
    /// the right ids; `page` with `after_id > last` aborts with
    /// `EAfterIdTooHigh`; `page` with empty tag aborts with `EEmptyViewTag`;
    /// `page` with zero limit aborts with `ELimitZero`;
    /// `first_id`/`last_id`/`bucket_length`/`has_bucket` agree.
    ///
    /// All tests use the Sui 2024 no-arg form (`fun name() { … dummy ctx … }`).

    use sui::tx_context::TxContext;
    use upl::view_tag_index as vti;

    /// Single-record creates the bucket and sets total_indexed == 1.
    #[test]
    fun single_record_creates_bucket() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        vti::record(&mut index, x"ab", 0);

        assert!(vti::total_indexed(&index) == 1);
        assert!(vti::bucket_length(&index, x"ab") == 1);
        assert!(vti::has_bucket(&index, x"ab"));
        // Unknown tag → no bucket.
        assert!(!vti::has_bucket(&index, x"ff"));
        assert!(vti::bucket_length(&index, x"ff") == 0);

        vti::destroy_test_index(index);
    }

    /// Multi-record under the same tag: ids are in insertion order,
    /// bucket_length grows, and page returns the full ordered list.
    #[test]
    fun multi_record_same_tag_orders_ids() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        vti::record(&mut index, x"ab", 10);
        vti::record(&mut index, x"ab", 20);
        vti::record(&mut index, x"ab", 30);

        assert!(vti::total_indexed(&index) == 3);
        assert!(vti::bucket_length(&index, x"ab") == 3);

        // First page (after_id=0, limit=10).
        let page = vti::page(&index, x"ab", 0, 10);
        assert!(page.length() == 3);
        assert!(*page.borrow(0) == 10);
        assert!(*page.borrow(1) == 20);
        assert!(*page.borrow(2) == 30);

        // first_id / last_id.
        let mut first = vti::first_id(&index, x"ab");
        assert!(first.is_some());
        assert!(first.extract() == 10);
        let mut last = vti::last_id(&index, x"ab");
        assert!(last.is_some());
        assert!(last.extract() == 30);

        vti::destroy_test_index(index);
    }

    /// Multi-record across different tags: each tag gets its own bucket.
    #[test]
    fun multi_record_different_tags_separates_buckets() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        // Announcement ids are 1-based in production (the registry's first
        // announce is id 1), and `page`'s `after_id` uses `0` as the
        // "first page" sentinel — so ids here are 1-based to match that
        // invariant (see `page`'s docstring: "pass 0 for the first page").
        vti::record(&mut index, x"ab", 1);
        vti::record(&mut index, x"cd", 2);
        vti::record(&mut index, x"ab", 3);
        vti::record(&mut index, x"cd", 4);

        assert!(vti::total_indexed(&index) == 4);
        assert!(vti::bucket_length(&index, x"ab") == 2);
        assert!(vti::bucket_length(&index, x"cd") == 2);

        let ab_page = vti::page(&index, x"ab", 0, 10);
        assert!(ab_page.length() == 2);
        assert!(*ab_page.borrow(0) == 1);
        assert!(*ab_page.borrow(1) == 3);

        let cd_page = vti::page(&index, x"cd", 0, 10);
        assert!(cd_page.length() == 2);
        assert!(*cd_page.borrow(0) == 2);
        assert!(*cd_page.borrow(1) == 4);

        vti::destroy_test_index(index);
    }

    /// Pagination: `page(after_id, limit)` returns up to `limit` ids strictly
    /// after `after_id`. Two pages of limit=2 over a 5-id bucket.
    #[test]
    fun pagination_returns_bounded_pages() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        // Insert 5 ids under "ab": 100, 101, 102, 103, 104.
        let mut i = 100;
        while (i < 105) {
            vti::record(&mut index, x"ab", i);
            i = i + 1;
        };

        // Page 1: after_id=0, limit=2 → [100, 101].
        let p1 = vti::page(&index, x"ab", 0, 2);
        assert!(p1.length() == 2);
        assert!(*p1.borrow(0) == 100);
        assert!(*p1.borrow(1) == 101);

        // Page 2: after_id=101, limit=2 → [102, 103].
        let p2 = vti::page(&index, x"ab", 101, 2);
        assert!(p2.length() == 2);
        assert!(*p2.borrow(0) == 102);
        assert!(*p2.borrow(1) == 103);

        // Page 3: after_id=103, limit=2 → [104] (partial page = end).
        let p3 = vti::page(&index, x"ab", 103, 2);
        assert!(p3.length() == 1);
        assert!(*p3.borrow(0) == 104);

        // Page 4: after_id=104, limit=2 → empty (legitimate end-of-bucket).
        let p4 = vti::page(&index, x"ab", 104, 2);
        assert!(p4.is_empty());

        vti::destroy_test_index(index);
    }

    /// `page` on an unknown tag returns an empty vector (not an abort) —
    /// distinct from "after_id > last" which IS an abort.
    #[test]
    fun page_on_unknown_tag_returns_empty() {
        let mut ctx = tx_context::dummy();
        let index = vti::new_test_index(&mut ctx);

        let result = vti::page(&index, x"aa", 0, 10);
        assert!(result.is_empty());

        // first_id / last_id on unknown tag → None.
        let f = vti::first_id(&index, x"aa");
        assert!(f.is_none());
        let l = vti::last_id(&index, x"aa");
        assert!(l.is_none());

        vti::destroy_test_index(index);
    }

    /// `page` with `after_id` greater than every id in the bucket aborts with
    /// `EAfterIdTooHigh` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun page_after_id_too_high_aborts() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);
        vti::record(&mut index, x"ab", 10);
        vti::record(&mut index, x"ab", 20);
        // after_id=999 > last id=20 → abort.
        let _ = vti::page(&index, x"ab", 999, 10);
        vti::destroy_test_index(index);
    }

    /// `record` with an empty `view_tag` aborts with `EEmptyViewTag` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun record_empty_view_tag_aborts() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);
        vti::record(&mut index, x"", 0);
        vti::destroy_test_index(index);
    }

    /// `page` with `limit == 0` aborts with `ELimitZero` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun page_limit_zero_aborts() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);
        vti::record(&mut index, x"ab", 0);
        let _ = vti::page(&index, x"ab", 0, 0);
        vti::destroy_test_index(index);
    }

    /// `page` with `limit > MAX_PAGE` is clamped: requesting 1000 on a
    /// 300-id bucket returns at most MAX_PAGE == 256.
    #[test]
    fun page_limit_clamped_to_max_page() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        // Insert 300 ids under "ab": 1..300 (1-based, see `multi_record...`).
        let mut i = 1;
        while (i <= 300) {
            vti::record(&mut index, x"ab", i);
            i = i + 1;
        };

        // Request limit=1000 → clamped to 256, returns 256 ids (1..256).
        let page = vti::page(&index, x"ab", 0, 1000);
        assert!(page.length() == 256);
        assert!(*page.borrow(0) == 1);
        assert!(*page.borrow(255) == 256);

        // Continue from id 256, again limit=1000 → 44 remaining (257..300).
        let page2 = vti::page(&index, x"ab", 256, 1000);
        assert!(page2.length() == 44);
        assert!(*page2.borrow(0) == 257);
        assert!(*page2.borrow(43) == 300);

        vti::destroy_test_index(index);
    }

    /// `first_id`/`last_id` on an empty-but-existing bucket returns `None`.
    /// (In our implementation a bucket is only created on `record`, so this
    /// cannot actually happen in production, but the accessors are defensive.)
    #[test]
    fun first_and_last_id_on_populated_bucket() {
        let mut ctx = tx_context::dummy();
        let mut index = vti::new_test_index(&mut ctx);

        vti::record(&mut index, x"ab", 5);
        vti::record(&mut index, x"ab", 15);
        vti::record(&mut index, x"ab", 25);

        let mut f = vti::first_id(&index, x"ab");
        assert!(f.is_some());
        assert!(f.extract() == 5);

        let mut l = vti::last_id(&index, x"ab");
        assert!(l.is_some());
        assert!(l.extract() == 25);

        // Unknown tag → None.
        let f2 = vti::first_id(&index, x"cd");
        assert!(f2.is_none());
        let l2 = vti::last_id(&index, x"cd");
        assert!(l2.is_none());

        vti::destroy_test_index(index);
    }
}
