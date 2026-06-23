// SPDX-License-Identifier: MIT
module upl::view_tag_index {
    /// Per-view-tag bucketed id index over `stealth_address_registry`.
    ///
    /// `stealth_address_registry` deliberately keeps only a **first-write-wins**
    /// `by_view_tag` lookup: the `Table<vector<u8>, u64>` holds the *single* id
    /// of the first announcement ever inserted under a view tag. That is enough
    /// for the canonical "I see my view tag, derive DH once" fast scan, but it
    /// is **not** enough for the matching problem a recipient actually has on a
    /// growing registry: a single view tag legitimately recurs across many
    /// announcements (the same recipient receiving many transfers under one
    /// tag), and the EVM contract admitted this by exposing a full `scanRange`
    /// `for (i = 0; i < n; i++)` linear pass.
    ///
    /// The Move `stealth_address_registry` deliberately did NOT port `scanRange`
    /// (its docstring spells out that an unbounded per-element-storage-read Vec
    /// return is a gas antipattern on Sui) and pushed timestamp-range scans to
    /// indexers reading the `StealthAnnouncement` event stream. That is the
    /// *right* answer for timestamp/range queries — events are how Sui indexers
    /// work — but it leaves the **view-tag bucket** query with no on-chain
    /// surface at all. This module fills that one specific gap.
    ///
    /// What it is: a shared `ViewTagIndex` keyed by `view_tag -> ordered Vec<u64>`
    /// of announcement ids. Announcements are appended here **in addition to**
    /// the registry append-only log — the registry remains the source of truth
    /// for the `Announcement` records themselves; this index only stores ids.
    /// A scanner asks "give me every announcement under my view tag, newest ids
    /// I have not yet scanned" and gets an ordered, bounded response with O(1)
    /// per-id storage append + O(k) bounded-page read, where `k` is the page
    /// size — never an unbounded return.
    ///
    /// Why this is honest (not padding): the existing registry's first-write-wins
    /// index is documented as a *deliberate* scope cut. This module is the
    /// on-chain half of the cut it left implicit: it makes the
    /// "every announcement under tag X" query expressible on-chain on Sui
    /// without the gas-antipattern full-table scan, and it bounds the response
    /// size by page. Indexers that already track events can ignore it; wallets
    /// that want an on-chain authoritative bucket read (e.g. a hardware wallet
    /// that refuses to trust an indexer) use it.
    ///
    /// Semantic notes vs. the EVM `StealthAddressRegistry`:
    ///   - This is a Sui-native extension: the EVM contract had no second index,
    ///     only the first-write-wins `viewTagIndex` mapping + the O(n) `scanRange`.
    ///     We do NOT port `scanRange`; we port a *bounded* bucketed index.
    ///   - `view_tag` is `vector<u8>` (the canonical 1-byte EIP-5564 tag, same
    ///     shape `stealth_address_registry::announce` accepts). Bytes here are
    ///     NOT validated against the registry's non-empty rule at insert time:
    ///     `record` aborts on empty `view_tag` so the invariant holds.
    ///   - The index stores announcement **ids**, not records. A reader that
    ///     wants the full record follows ids back into the registry via
    ///     `stealth_address_registry::get_announcement(id)`. This keeps the
    ///     index small (one `u64` per announcement) and avoids duplicating the
    ///     registry's storage.
    ///   - Reads are deliberately **bounded**: `page(view_tag, after_id, limit)`
    ///     returns up to `limit` ids strictly greater than `after_id`. The
    ///     caller drives pagination by passing the last id received as the next
    ///     `after_id`. `limit` is clamped to `MAX_PAGE` so a wallet cannot
    ///     accidentally request the whole registry back as one Vec.
    ///   - Deletion is NOT supported. The registry is append-only; an index that
    ///     permitted removals would diverge from the registry's ids. The index
    ///     only ever grows — same append-only discipline as the registry it
    ///     mirrors.

    use sui::event;
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use std::option::{Self, Option};
    use std::vector;

    /// Bounded ordered id list under one view tag. Held as the *value* of a
    /// `Table<vector<u8>, Bucket>` so each tag owns its own vector of ids in
    /// increasing insertion order. `copy+drop` so `page` may return id slices
    /// by value without borrow-table-value gymnastics.
    public struct Bucket has store, copy, drop {
        /// Ordered announcement ids, oldest-first. Append-only.
        ids: vector<u64>,
    }

    /// Shared per-view-tag bucketed id index. `key` so it can be shared. The
    /// outer `Table<vector<u8>, Bucket>` maps each seen view tag to its bucket;
    /// `total_indexed` is the cross-tag sum of `Bucket.ids` lengths, useful as
    /// a sanity counter (should equal the registry's `announcement_count`
    /// whenever this index is kept in lockstep with the registry).
    public struct ViewTagIndex has key {
        id: UID,
        buckets: Table<vector<u8>, Bucket>,
        total_indexed: u64,
    }

    /// Event emitted on every id inserted under a tag. An indexer that does NOT
    /// read the index object directly can rebuild the buckets from this stream
    /// (the same way it already rebuilds the registry from
    /// `StealthAnnouncement`).
    public struct IdIndexed has copy, drop {
        view_tag: vector<u8>,
        announcement_id: u64,
        /// Position of this id within its bucket (0-based, == bucket length
        /// before this insert). Lets an indexer confirm ordering without a
        /// separate read.
        position: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    /// Returned when `record`/`page` is given an empty `view_tag` (the
    /// canonical 1-byte EIP-5564 tag is never empty; empty == caller bug).
    const EEmptyViewTag: u64 = 1;
    /// Returned when `page` is asked for an `after_id` that exceeds every id
    /// in the bucket — caller paginated past the end.
    const EAfterIdTooHigh: u64 = 2;
    /// Returned when `page` is given `limit == 0` — a zero-page request is a
    /// caller bug (use `bucket_length` if you only want the count).
    const ELimitZero: u64 = 3;

    /// Hard cap on `page` `limit`. Picked so a wallet scanning a busy tag
    /// cannot accidentally pull the entire bucket back as one `vector<u64>`.
    /// The pagination contract is: you get at most `MAX_PAGE` ids per call,
    /// you re-call with the last received id as `after_id` to continue.
    const MAX_PAGE: u64 = 256;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `ViewTagIndex`. Called exactly once at package publish.
    /// No cap: this index is a permissionless, append-only read-mostly mirror
    /// of the registry — `record` is callable by anyone (the relayer is the
    /// conventional caller, mirroring how `stealth_address_registry::announce`
    /// is permissionless).
    fun init(ctx: &mut TxContext) {
        let index = ViewTagIndex {
            id: object::new(ctx),
            buckets: table::new(ctx),
            total_indexed: 0,
        };
        transfer::share_object(index);
    }

    // ─── Public entry — the only writer ─────────────────────────────────────
    /// Record that announcement `announcement_id` lives under `view_tag`.
    /// Appends the id to the bucket, creating the bucket on first sight of the
    /// tag. **Does NOT verify the id exists in the registry** — keeping the
    /// index decoupled from a `&Registry` borrow lets `record` be composed in a
    /// PTB right after `stealth_address_registry::announce` without taking the
    /// shared registry a second time. A scanner that resolves a recorded id via
    /// `stealth_address_registry::get_announcement` will abort on a bogus id,
    /// so a malicious `record` call cannot poison a scanner past that resolve.
    ///
    /// Conventional use: the relayer calls `stealth_address_registry::announce`
    /// (which returns the fresh id via `announcement_count` snapshot), then
    /// immediately calls `view_tag_index::record` with that id + the same
    /// `view_tag`, in the same PTB. The two inserts are atomic; if either
    /// aborts the whole PTB rolls back.
    public(package) entry fun record(
        index: &mut ViewTagIndex,
        view_tag: vector<u8>,
        announcement_id: u64,
    ) {
        assert!(!vector::is_empty(&view_tag), EEmptyViewTag);

        if (!table::contains(&index.buckets, view_tag)) {
            table::add(&mut index.buckets, view_tag, Bucket { ids: vector::empty<u64>() });
        };
        let bucket = table::borrow_mut(&mut index.buckets, view_tag);
        let position = vector::length(&bucket.ids);
        vector::push_back(&mut bucket.ids, announcement_id);
        index.total_indexed = index.total_indexed + 1;

        event::emit(IdIndexed {
            view_tag,
            announcement_id,
            position,
        });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Total ids recorded across all buckets. A scanner uses this to size its
    /// on-chain-scan budget; in a healthy lockstep deployment it equals
    /// `stealth_address_registry::announcement_count`.
    public fun total_indexed(index: &ViewTagIndex): u64 { index.total_indexed }

    /// Number of ids recorded under `view_tag`, or `0` if the tag has never
    /// been recorded. The scanner calls this before `page` to size its loop.
    public fun bucket_length(index: &ViewTagIndex, view_tag: vector<u8>): u64 {
        if (table::contains(&index.buckets, view_tag)) {
            vector::length(&table::borrow(&index.buckets, view_tag).ids)
        } else {
            0
        }
    }

    /// Whether `view_tag` has any recorded ids. Convenience over
    /// `bucket_length(...) > 0` for the common skip-scan branch.
    public fun has_bucket(index: &ViewTagIndex, view_tag: vector<u8>): bool {
        table::contains(&index.buckets, view_tag)
    }

    /// Read up to `limit` ids under `view_tag` strictly after `after_id`,
    /// oldest-first. `after_id` lets the caller paginate: pass `0` for the
    /// first page, then pass the last id of each returned page as the next
    /// `after_id` until a shorter page (or `EAfterIdTooHigh`) signals the end.
    ///
    /// `limit` is clamped to `MAX_PAGE`. Returns an *empty* vector — NOT an
    /// abort — when the bucket is empty or `after_id` is the last id (the
    /// caller has reached the end of the bucket). Aborts with
    /// `EAfterIdTooHigh` only when `after_id` exceeds every id in the bucket.
    public fun page(
        index: &ViewTagIndex,
        view_tag: vector<u8>,
        after_id: u64,
        limit: u64,
    ): vector<u64> {
        assert!(limit > 0, ELimitZero);
        let cap = if (limit <= MAX_PAGE) { limit } else { MAX_PAGE };

        if (!table::contains(&index.buckets, view_tag)) {
            return vector::empty<u64>()
        };
        let bucket = table::borrow(&index.buckets, view_tag);
        let ids = &bucket.ids;
        let n = vector::length(ids);

        // Find the first index whose id is strictly > after_id. Ids are
        // append-ordered; this linear search is bounded by `n` which is
        // itself bounded by the per-tag bucket size.
        let mut start = 0;
        let mut found = false;
        let mut i = 0;
        while (i < n) {
            let id = *vector::borrow(ids, i);
            if (id > after_id) {
                start = i;
                found = true;
                break
            };
            i = i + 1;
        };

        if (!found) {
            // after_id >= every id in the bucket. "after_id == last" is
            // legitimate end-of-pagination → empty. "after_id > last" is
            // a caller bug → abort.
            let last = if (n > 0) { *vector::borrow(ids, n - 1) } else { 0 };
            assert!(after_id <= last, EAfterIdTooHigh);
            return vector::empty<u64>()
        };

        // Collect up to `cap` ids from `start`.
        let mut out = vector::empty<u64>();
        let mut j = start;
        let mut taken = 0;
        while (j < n && taken < cap) {
            vector::push_back(&mut out, *vector::borrow(ids, j));
            j = j + 1;
            taken = taken + 1;
        };
        out
    }

    /// Read the *first* id ever recorded under `view_tag`, or `None` if the
    /// tag was never recorded. Convenience matching the registry's existing
    /// first-write-wins lookup — lets a scanner that only cares about the
    /// oldest entry per tag skip pagination.
    public fun first_id(index: &ViewTagIndex, view_tag: vector<u8>): Option<u64> {
        if (table::contains(&index.buckets, view_tag)) {
            let ids = &table::borrow(&index.buckets, view_tag).ids;
            if (vector::is_empty(ids)) {
                option::none()
            } else {
                option::some(*vector::borrow(ids, 0))
            }
        } else {
            option::none()
        }
    }

    /// Read the *last* (newest) id recorded under `view_tag`, or `None` if
    /// never recorded. The scanner uses this to detect "new work since my
    /// last scan" without paging — if `last_id > my_cursor`, rerun `page`.
    public fun last_id(index: &ViewTagIndex, view_tag: vector<u8>): Option<u64> {
        if (table::contains(&index.buckets, view_tag)) {
            let ids = &table::borrow(&index.buckets, view_tag).ids;
            if (vector::is_empty(ids)) {
                option::none()
            } else {
                option::some(*vector::borrow(ids, vector::length(ids) - 1))
            }
        } else {
            option::none()
        }
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──
    /// Create a fresh caller-owned `ViewTagIndex` for tests that do not want
    /// to go through the publish-time `init` flow.
    #[test_only]
    public fun new_test_index(ctx: &mut TxContext): ViewTagIndex {
        ViewTagIndex {
            id: object::new(ctx),
            buckets: table::new(ctx),
            total_indexed: 0,
        }
    }

    /// Drop a caller-owned `ViewTagIndex` at end of a test. The backing
    /// `Table` is moved out via destructuring and dropped; `Bucket` carries
    /// `drop` (it's `store+copy+drop`), so `table::drop` releases its
    /// dynamic-field storage. The `id` is freed via `object::delete`.
    #[test_only]
    public fun destroy_test_index(index: ViewTagIndex) {
        let ViewTagIndex { id, buckets, total_indexed: _ } = index;
        table::drop(buckets);
        object::delete(id);
    }
}
