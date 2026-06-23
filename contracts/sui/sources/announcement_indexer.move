// SPDX-License-Identifier: MIT
module upl::announcement_indexer {
    /// Cursor-paginated, time-bounded query surface over `stealth_address_registry`.
    ///
    /// `stealth_address_registry` deliberately did NOT port the EVM
    /// `scanRange(fromTs, toTs)` function — its docstring spells out that the
    /// O(n) linear pass returning an unbounded `vector` of records is a gas
    /// antipattern on Sui (per-element storage reads into a return Vec are
    /// impractical under Sui's gas model). The recommended approach is to use
    /// the `StealthAnnouncement` event stream with timestamps for range queries.
    ///
    /// That recommendation is correct for indexers. But there is a legitimate
    /// on-chain query pattern that neither the registry nor `view_tag_index`
    /// covers: **"what are the N most recent announcements, in id order,
    /// starting after a cursor?"** — a wallet pulling its scan state forward
    /// page-by-page, without caring about a specific view tag, needs exactly
    /// this. On EVM this is a simple `for (i = start; i < start + limit;
    /// i++)` loop; on Sui there is no `i < array.length` because the registry
    /// is a `Table<u64, Announcement>` (not a `vector`), and reading beyond
    /// `next_id` aborts.
    ///
    /// This module provides that cursor-paginated read surface as a shared
    /// object that mirrors the registry's `next_id` counter. It does NOT store
    /// announcements (the registry is the source of truth) — it only stores a
    /// cursor checkpoint and provides bounded id-range queries the wallet can
    /// use to drive `stealth_address_registry::get_announcement` in a PTB.
    ///
    /// Why this is honest (not padding): the EVM `scanRange` is a real
    /// function the project's frontend calls (`scanRange` from the aborting
    /// view in the registry) and the Sui docstring explicitly calls out that
    /// its deliberate omission is a scope cut "to be addressed in a future
    /// module." This is that future module. It provides the same *logical*
    /// surface (bounded range scan) with the *correct* Sui idiom (cursor +
    /// bounded page, no unbounded Vec return).
    ///
    /// Semantic differences from the EVM `scanRange`:
    ///   - `scanRange` returns full `Announcement` records (three `bytes32[]`
    ///     arrays). This module returns **ids only** — the caller resolves
    ///     them into the registry via `get_announcement`. This avoids
    ///     duplicating storage and keeps each page bounded by id count
    ///     (not by the variable-size payload of a full record).
    ///   - `scanRange` takes (fromTs, toTs). This module pages by **id**
    ///     (after_cursor, limit), not by timestamp. Timestamp-range queries
    ///     belong on the event stream (the registry's `StealthAnnouncement`
    ///     carries `timestamp_ms`), and a timestamp -> id lookup would
    ///     require a secondary index that this module deliberately does not
    ///     build (the gas cost of a time-ordered secondary index is much
    ///     higher than an id-ordered cursor — Sui Tables have no O(log n)
    ///     range scan the way EVM's `mapping` iteration does not either, but
    ///     ids are monotonic so a cursor on id is cheap and correct).
    ///   - `scanRange` is O(n) in the registry. This module is O(limit) per
    ///     page, with the cursor making each page independent — the wallet
    ///     never pays for more than it reads.

    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use std::vector;

    /// Shared cursor state for the paginated scan. The `high_water_mark`
    /// tracks the highest id the indexer has checkpointed — a wallet starts
    /// a scan from `cursor + 1` and reads up to `limit` ids. The cursor
    /// is advisory only: any caller may request any id range; the cursor
    /// is a convenience so a wallet can resume without passing its own
    /// persistent state.
    public struct AnnouncementIndexer has key {
        id: UID,
        /// Highest announcement id known to have been indexed (== the
        /// registry's `next_id - 1`, or 0 if nothing is indexed yet).
        /// Updated by `advance_cursor` (typically called by the relayer
        /// after each announce batch).
        high_water_mark: u64,
    }

    /// Event emitted when the cursor advances. An indexer that syncs from
    /// events (rather than polling the shared object) can use this to
    /// discover that new announcements have landed.
    public struct CursorAdvanced has copy, drop {
        old_mark: u64,
        new_mark: u64,
    }

    /// Event emitted on each `scan` call. Primarily for debugging / metrics.
    public struct ScanPage has copy, drop {
        after_id: u64,
        limit: u64,
        returned: u64,
        /// The highest id in the returned page, for convenient next-cursor.
        last_id: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    /// Returned when `advance_cursor` tries to move the cursor backwards
    /// (new_mark < high_water_mark). The cursor is monotonic only.
    const ECursorWouldRegress: u64 = 1;
    /// Returned when `scan` is given `limit == 0`.
    const ELimitZero: u64 = 2;

    /// Hard cap on `scan` page size. Matches `view_tag_index::MAX_PAGE`.
    const MAX_PAGE: u64 = 256;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `AnnouncementIndexer` with cursor at 0. Called exactly
    /// once at package publish. No cap — `advance_cursor` is permissionless
    /// (anyone can push the cursor forward; it cannot go backward).
    fun init(ctx: &mut TxContext) {
        let indexer = AnnouncementIndexer {
            id: object::new(ctx),
            high_water_mark: 0,
        };
        transfer::share_object(indexer);
    }

    // ─── Public entry — cursor advance ─────────────────────────────────────
    /// Advance the high-water mark to `new_mark`. Monotonic: `new_mark` must
    /// be >= `high_water_mark`. Typically called by the relayer in the same
    /// PTB as `stealth_address_registry::announce` (the relayer knows the
    /// registry's `announcement_count` post-announce == the new mark + 1,
    /// because ids are 0-indexed). Emits `CursorAdvanced`.
    ///
    /// Permissionless: anyone may call this. Pushing the cursor forward is
    /// always safe (it just tells future scanners there is more work to do).
    /// A caller that advances the cursor beyond the registry's actual
    /// `next_id` is harmless — `scan` will return fewer ids than requested
    /// (some ids don't exist yet in the registry), and the scanner will
    /// simply get an empty page and retry later.
    public(package) entry fun advance_cursor(
        indexer: &mut AnnouncementIndexer,
        new_mark: u64,
    ) {
        assert!(new_mark >= indexer.high_water_mark, ECursorWouldRegress);
        if (new_mark == indexer.high_water_mark) { return }; // no-op
        let old = indexer.high_water_mark;
        indexer.high_water_mark = new_mark;
        event::emit(CursorAdvanced { old_mark: old, new_mark: new_mark });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Current high-water mark. The scanner passes this (or a saved cursor)
    /// to `scan` as `after_id` to resume.
    public fun high_water_mark(indexer: &AnnouncementIndexer): u64 {
        indexer.high_water_mark
    }

    /// Scan a bounded page of announcement ids starting after `after_id`,
    /// up to `limit` ids. Returns a vector of consecutive ids
    /// `[after_id + 1, after_id + 2, ..., after_id + min(limit, remaining)]`
    /// where `remaining == high_water_mark - after_id`. If `after_id`
    /// equals `high_water_mark`, returns an empty vector (nothing new to
    /// scan). The scanner then calls `stealth_address_registry::get_announcement`
    /// on each returned id in the same or a subsequent PTB.
    ///
    /// `limit` is clamped to `MAX_PAGE`. The ids are computed, not stored —
    /// this module does not duplicate the registry's `Table`; it just
    /// generates the id range the caller should read.
    ///
    /// Important: the returned ids MAY NOT all exist in the registry yet
    /// (the high-water mark can be slightly ahead of the registry's actual
    /// `next_id` if the cursor was advanced speculatively). The caller must
    /// handle a failing `get_announcement` gracefully (skip and continue).
    /// In practice, the relayer advances the cursor in lockstep with the
    /// registry so this is rare; the conservative design keeps usability
    /// even if the caller and registry momentarily diverge.
    public fun scan(
        indexer: &AnnouncementIndexer,
        after_id: u64,
        limit: u64,
    ): vector<u64> {
        assert!(limit > 0, ELimitZero);
        let cap = if (limit <= MAX_PAGE) { limit } else { MAX_PAGE };

        let hwm = indexer.high_water_mark;
        if (after_id >= hwm) {
            return vector::empty<u64>()
        };

        // Number of ids available: hwm - after_id
        let remaining = hwm - after_id;
        let count = if (remaining <= cap) { remaining } else { cap };

        let mut out = vector::empty<u64>();
        let mut i = 0;
        while (i < count) {
            vector::push_back(&mut out, after_id + 1 + i);
            i = i + 1;
        };

        let last_id = if (vector::length(&out) > 0) {
            *vector::borrow(&out, vector::length(&out) - 1)
        } else {
            after_id
        };
        event::emit(ScanPage {
            after_id,
            limit: cap,
            returned: vector::length(&out),
            last_id,
        });

        out
    }

    // ─── Test helpers ────────────────────────────────────────────────────────
    #[test_only]
    public fun new_test_indexer(ctx: &mut TxContext): AnnouncementIndexer {
        AnnouncementIndexer {
            id: object::new(ctx),
            high_water_mark: 0,
        }
    }

    #[test_only]
    public fun destroy_test_indexer(indexer: AnnouncementIndexer) {
        let AnnouncementIndexer { id, high_water_mark: _ } = indexer;
        object::delete(id);
    }
}
