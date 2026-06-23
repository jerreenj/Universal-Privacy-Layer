// SPDX-License-Identifier: MIT
module upl::stealth_address_registry {
    /// EIP-5564-style stealth address announcement registry.
    ///
    /// Ported from `StealthAddressRegistry.sol` (EVM) as a Sui Move package under
    /// `upl::stealth_address_registry`. Each private send writes one *announcement*
    /// — ephemeral public-key, view tag, stealth-hash, announcer, and a
    /// timestamp — so the recipient's off-chain scanner can derive its spendable
    /// stealth key. The registry stores only public data; **no stealth private
    /// keys are ever on-chain**.
    ///
    /// Semantic differences from the EVM original (`StealthAddressRegistry.sol`):
    ///   - `bytes32` ephemeralPubKeyX/Y halves collapse to a single
    ///     `vector<u8>` (the X/Y split was an EVM ABI-codec artifact; Move has
    ///     no analog so we accept the natural vector).
    ///   - `bytes32` view_tag -> `vector<u8>` (canonical 1-byte EIP-5564 tag, no
    ///     left-padding; the EVM pad-to-32 was an artifact of fixed-size storage
    ///     slots).
    ///   - The `viewTagIndex` mapping's offset-by-1 sentinel (disambiguating
    ///     "0 = not found" from "0 = real index") is replaced with a clean
    ///     `Option<u64>` via an explicit `contains` check on the
    ///     `Table<vector<u8>, u64>` index. This eliminates the entire bug class
    ///     the offset fixed.
    ///   - `block.timestamp` (uint64 seconds) is replaced by the shared Sui
    ///     `Clock` object's `timestamp_ms()` (milliseconds); the raw ms value is
    ///     stored and the unit is documented in `Announcement.timestamp_ms`.
    ///   - `scanRange(fromTs, toTs)` O(n) two-pass array-return is **deliberately
    ///     NOT ported**: a documented gas antipattern that does not translate to
    ///     Move (per-element storage reads + an unbounded returned Vec<u8> are
    ///     impractical on Sui). Indexers query events by timestamp range via
    ///     the emitted `StealthAnnouncement` event instead. See the README
    ///     "Sui Move package" note.
    ///   - The EVM `announce` recorded `msg.sender` as the announcer. Sui Move
    ///     2024 has no `msg.sender` runtime value; we read the sender from the
    ///     transaction's `&mut TxContext` via `tx_context::sender(ctx)` instead.
    ///     The registry itself remains an open, unowned mailbox (matching the
    ///     EVM contract, which does not inherit `Ownable` per the P1.1/P1.2
    ///     reconciliation). A `RelayerCap` gate (see `privacy_relayer.move`) is
    ///     what links a real transfer to an announcement.
    ///
    /// Module layout: a single shared `Registry` object (minted in `init`,
    /// shared via `transfer::share_object`) holds a `Table<u64, Announcement>`
    /// keyed by monotonically-increasing id and a per-view-tag
    /// `Table<vector<u8>, u64>` first-write-wins index.

    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};
    use std::vector;

    /// Public, indexed-by-id announcement record. Mirrors the EVM struct;
    /// snake_case because Move idiom is snake_case. `copy`+`drop` so reads may
    /// return it by value (no `Option<&T>` needed).
    public struct Announcement has store, copy, drop {
        /// Ephemeral public key (opaque bytes; the recipient's scanner parses
        /// the encoding — we accept any non-empty vector and do not validate
        /// the encoding on-chain).
        ephemeral_pub_key: vector<u8>,
        /// EIP-5564 view tag — canonical 1-byte tag the recipient uses to
        /// cheaply skip announcements not addressed to them.
        view_tag: vector<u8>,
        /// Stealth-hash / spend-commitment; opaque on-chain.
        stealth_hash: vector<u8>,
        /// Announcer — `tx_context::sender(ctx)` of the `announce` caller
        /// (the relayer in the happy-path).
        announcer: address,
        /// `Clock::timestamp_ms(&clock)` at announce time, in **milliseconds**
        /// (note: EVM used seconds). Divide by 1000 for second-grain queries.
        timestamp_ms: u64,
    }

    /// Shared registry state: monotonic id counter + id-keyed announcement
    /// table + per-view-tag first-write-wins lookup table.
    public struct Registry has key {
        id: UID,
        /// Next id to allocate (mirrors `announcementCount`; equals the number
        /// of announcements ever inserted because ids are monotonic from 0).
        next_id: u64,
        /// `id -> Announcement` append-only log.
        announcements: Table<u64, Announcement>,
        /// `view_tag -> id` first-write-wins index. A view-tag present here is
        /// guaranteed to have a corresponding row in `announcements`.
        by_view_tag: Table<vector<u8>, u64>,
    }

    /// Event emitted on every successful `announce`. All fields queryable by a
    /// Sui indexer; no "indexed vs non-indexed" distinction (Sui events are
    /// fully queryable).
    public struct StealthAnnouncement has copy, drop {
        id: u64,
        view_tag: vector<u8>,
        announcer: address,
        stealth_hash: vector<u8>,
        ephemeral_pub_key: vector<u8>,
        timestamp_ms: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    /// Returned when `ephemeral_pub_key` is empty (EVM required `X!=0 || Y!=0`).
    const EEmptyEphemeralPubKey: u64 = 1;
    /// Returned when `view_tag` is empty (EVM required `viewTag!=0`).
    const EEmptyViewTag: u64 = 2;
    /// Returned when `get_announcement` asks for an id that doesn't exist.
    const EAnnouncementNotFound: u64 = 3;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `Registry`. Called exactly once at package publish.
    /// No `AdminCap`/cap is minted — this registry is intentionally unowned and
    /// permissionless, matching the EVM `StealthAddressRegistry` which does
    /// not inherit `Ownable` (per the P1.1/P1.2 reconciliation).
    fun init(ctx: &mut TxContext) {
        let registry = Registry {
            id: object::new(ctx),
            next_id: 0,
            announcements: table::new(ctx),
            by_view_tag: table::new(ctx),
        };
        transfer::share_object(registry);
    }

    // ─── Public entry — the only writer ─────────────────────────────────────
    /// Append a stealth-address announcement. Permissionless: any sender may
    /// call. The relayer is the conventional caller (see `privacy_relayer.move`);
    /// anyone can also call it off-cycle to grow the anonymity set.
    ///
    /// First-write-wins on the per-view-tag index: if `view_tag` was already
    /// inserted, the existing id stays bound; the new row still gets a fresh id
    /// and is reachable via `get_announcement(id)` and the event stream.
    ///
    /// The sender is read from `ctx` rather than a `&signer` parameter because
    /// Sui Move 2024 exposes the transaction sender via `TxContext`; the EVM
    /// `msg.sender` maps cleanly to `tx_context::sender(ctx)`.
    public(package) entry fun announce(
        ctx: &TxContext,
        registry: &mut Registry,
        ephemeral_pub_key: vector<u8>,
        view_tag: vector<u8>,
        stealth_hash: vector<u8>,
        clock: &Clock,
    ) {
        assert!(!vector::is_empty(&ephemeral_pub_key), EEmptyEphemeralPubKey);
        assert!(!vector::is_empty(&view_tag), EEmptyViewTag);

        let id = registry.next_id;
        registry.next_id = id + 1;

        let timestamp_ms = clock::timestamp_ms(clock);
        let announcer = tx_context::sender(ctx);

        if (!table::contains(&registry.by_view_tag, view_tag)) {
            table::add(&mut registry.by_view_tag, view_tag, id);
        };

        let record = Announcement {
            ephemeral_pub_key,
            view_tag,
            stealth_hash,
            announcer,
            timestamp_ms,
        };
        table::add(&mut registry.announcements, id, record);

        event::emit(StealthAnnouncement {
            id,
            view_tag,
            announcer,
            stealth_hash,
            ephemeral_pub_key,
            timestamp_ms,
        });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Total announcements ever inserted. Equal to `next_id` since ids are
    /// monotonic from 0 and nothing is ever removed.
    public fun announcement_count(registry: &Registry): u64 {
        registry.next_id
    }

    /// Borrow the announcement at `id`. Aborts with `EAnnouncementNotFound` if
    /// the id was never inserted.
    public fun get_announcement(registry: &Registry, id: u64): &Announcement {
        assert!(
            table::contains(&registry.announcements, id),
            EAnnouncementNotFound
        );
        table::borrow(&registry.announcements, id)
    }

    /// Resolve the id bound to `view_tag`, or `None` if never inserted. This is
    /// the Sui-clean replacement for the EVM offset-by-1 trick — `Option<u64>`
    /// has an explicit "absent" value, so callers never confuse "not found"
    /// with "found at index 0".
    public fun id_for_view_tag(registry: &Registry, view_tag: vector<u8>): Option<u64> {
        if (table::contains(&registry.by_view_tag, view_tag)) {
            option::some(*table::borrow(&registry.by_view_tag, view_tag))
        } else {
            option::none()
        }
    }

    /// Resolve the id bound to `view_tag`, aborting with `EAnnouncementNotFound`
    /// if it was never inserted. Convenience for callers that have already
    /// checked presence and want the id without an `Option` unwrap.
    public fun id_for_view_tag_or_abort(registry: &Registry, view_tag: vector<u8>): u64 {
        assert!(
            table::contains(&registry.by_view_tag, view_tag),
            EAnnouncementNotFound
        );
        *table::borrow(&registry.by_view_tag, view_tag)
    }

    // ─── Field getters (typed accessors; indexers may prefer these over
    // borrowing the whole struct) ────────────────────────────────────────────
    public fun ephemeral_pub_key(a: &Announcement): &vector<u8> { &a.ephemeral_pub_key }
    public fun view_tag(a: &Announcement): &vector<u8> { &a.view_tag }
    public fun stealth_hash(a: &Announcement): &vector<u8> { &a.stealth_hash }
    public fun announcer(a: &Announcement): address { a.announcer }
    public fun timestamp_ms(a: &Announcement): u64 { a.timestamp_ms }

    // ─── Test helpers (#[test_only] lives in tests/* per Sui convention; the
    // helper below is test-only and excluded from the published package) ──────
    #[test_only]
    /// Create a fresh caller-owned `Registry` for tests that do not want to
    /// go through the publish-time `init` flow.
    public fun new_test_registry(ctx: &mut TxContext): Registry {
        Registry {
            id: object::new(ctx),
            next_id: 0,
            announcements: table::new(ctx),
            by_view_tag: table::new(ctx),
        }
    }

    /// Drop a caller-owned `Registry` at end of a test. The two backing `Table`s
    /// are moved out via destructuring and dropped; both value types carry
    /// `drop` (`Announcement` is `store + copy + drop`; the index value is
    /// `u64`), so `table::drop` releases their dynamic-field storage without
    /// the empty-invariant abort of `table::destroy_empty`. The `Registry`
    /// `id` is freed via `object::delete`.
    #[test_only]
    public fun destroy_test_registry(registry: Registry) {
        let Registry {
            id,
            next_id: _,
            announcements,
            by_view_tag,
        } = registry;
        table::drop(announcements);
        table::drop(by_view_tag);
        object::delete(id);
    }
}
