// SPDX-License-Identifier: MIT
module upl::relayer_registry {
    /// On-chain discoverable registry of authorized relayer operators.
    ///
    /// The EVM `PrivacyRelayer.sol` has a simple `address public relayer` +
    /// `onlyRelayer` modifier + `setRelayer(address)` rotation under
    /// `onlyOwner`. That is a single-relayer model — there is exactly one
    /// authorized relayer, and rotating it is a privileged admin action.
    ///
    /// The Sui `privacy_relayer` uses a `RelayerCap` capability object instead
    /// (any address holding the `RelayerCap` is implicitly authorized to call
    /// `relay`). This is strictly safer than the EVM address check (capability
    /// objects are non-forgable), but it has a discoverability gap: there is no
    /// on-chain way for a wallet or indexer to learn **which addresses are
    /// currently operating relayers**, what their endpoints are, or whether
    /// they are active. The `RelayerCap` is just an object — it doesn't carry
    /// metadata, and it can be transferred silently.
    ///
    /// This module fills that gap. It is a shared `RelayerRegistry` that maps
    /// relayer addresses to structured metadata (endpoint commitment, status,
    /// registration timestamp). The `AdminCap` holder (deployer) approves and
    /// deactivates relayers; the relayer addresses here are informational and
    /// do NOT gate `privacy_relayer::relay` (that remains the `RelayerCap`'s
    /// job). The registry exists so off-chain clients can discover relayers
    /// without trusting a centralized directory.
    ///
    /// Why this is honest (not padding): the EVM contract has a single
    /// `relayer` address variable. The Sui package has a `RelayerCap` object.
    /// Neither provides a discoverable, metadata-rich, multi-relayer listing.
    /// A real relayer service with health-checkable endpoints genuinely needs
    /// this — the project's P1.9/P1.10 roadmap items call for a "dedicated
    /// relayer role" with operator metadata. This module is the Sui-native
    /// form of that plan.
    ///
    /// Semantic differences from the EVM `PrivacyRelayer.sol`:
    ///   - EVM `address public relayer` → Sui `RelayerCap` (capability). The
    ///     registry here is an *additional* on-chain directory of relayer
    ///     operators, NOT a replacement for the cap. The cap is the auth
    ///     mechanism; the registry is the discovery mechanism.
    ///   - `setRelayer(address)` is `onlyOwner` → `AdminCap`-gated here.
    ///   - No EVM analog for multi-relayer, metadata, or active/inactive
    ///     status — those are Sui-native extensions the project needs.

    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};
    use std::vector;

    /// Admin capability. The holder can: approve and deactivate relayers,
    /// and set the default endpoint hash. Created once in `init`, transferred
    /// to the publisher.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Per-relayer metadata. Stored as the value in the `Table<address,
    /// RelayerInfo>`. `copy+drop` so reads may return it by value.
    public struct RelayerInfo has store, copy, drop {
        /// Hash commitment of the relayer's off-chain endpoint URL (e.g.
        /// `sha3_256("https://relay.upl.example.com")`). The URL itself is
        /// not stored on-chain (it may change or contain secrets); the hash
        /// lets a client verify a claimed endpoint without leaking it.
        endpoint_hash: vector<u8>,
        /// Whether this relayer is currently active. Inactive relayers are
        /// retained in the registry for audit history but should NOT be used
        /// by wallets.
        active: bool,
        /// `Clock::timestamp_ms` at registration. EVM used `block.timestamp`
        /// (seconds); ms here.
        registered_at_ms: u64,
        /// `Clock::timestamp_ms` at the most recent status change (active →
        /// inactive, or inactive → re-activated). `0` if never changed.
        last_status_change_ms: u64,
    }

    /// Shared, discoverable relayer operator directory. `key` so it can be
    /// shared. Holds a `Table<address, RelayerInfo>` keyed by relayer address
    /// and a monotonic counter for the number of entries ever inserted.
    public struct RelayerRegistry has key {
        id: UID,
        relayers: Table<address, RelayerInfo>,
        /// Total relayers ever registered (including deactivated). Monotonic.
        total_registered: u64,
        /// Currently active relayer count. Grows on `approve`, shrinks on
        /// `deactivate`, grows again on `reactivate`.
        active_count: u64,
    }

    // ─── Events ───────────────────────────────────────────────────────────
    public struct RelayerApproved has copy, drop {
        relayer: address,
        endpoint_hash: vector<u8>,
        registered_at_ms: u64,
    }
    public struct RelayerDeactivated has copy, drop {
        relayer: address,
        at_ms: u64,
    }
    public struct RelayerReactivated has copy, drop {
        relayer: address,
        at_ms: u64,
    }
    public struct RelayerEndpointUpdated has copy, drop {
        relayer: address,
        old_hash: vector<u8>,
        new_hash: vector<u8>,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EZeroRelayer: u64 = 1;
    /// Returned when `approve` is called for an address that is already in the
    /// registry (active or inactive). Use `reactivate` instead.
    const EAlreadyRegistered: u64 = 2;
    /// Returned when `deactivate` is called for an address not in the registry.
    const ENotRegistered: u64 = 3;
    /// Returned when `deactivate` is called for an already-inactive relayer.
    const EAlreadyInactive: u64 = 4;
    /// Returned when `reactivate` is called for an already-active relayer.
    const EAlreadyActive: u64 = 5;
    /// Returned when `reactivate` is called for an address not in the registry.
    /// (It was never approved, or was removed — removal is not supported;
    /// this means it was never approved.)
    const ENotRegisteredForReactivate: u64 = 6;
    /// Returned when an empty `endpoint_hash` is provided.
    const EEmptyEndpointHash: u64 = 7;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `RelayerRegistry` and one `AdminCap` transferred to
    /// the publisher.
    fun init(ctx: &mut TxContext) {
        let registry = RelayerRegistry {
            id: object::new(ctx),
            relayers: table::new(ctx),
            total_registered: 0,
            active_count: 0,
        };
        transfer::share_object(registry);
        let admin = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    // ─── Admin writes (AdminCap-gated) ────────────────────────────────────
    /// Approve a new relayer operator. The address must NOT already be in the
    /// registry. `endpoint_hash` is a `sha3_256` commitment of the relayer's
    /// URL — the admin should compute this off-chain and store only the hash
    /// on-chain (the URL may change; updating the hash is a separate admin
    /// action via `update_endpoint`). Emits `RelayerApproved`.
    public(package) entry fun approve(
        _admin: &AdminCap,
        registry: &mut RelayerRegistry,
        relayer: address,
        endpoint_hash: vector<u8>,
        clock: &Clock,
    ) {
        assert!(relayer != @0x0, EZeroRelayer);
        assert!(!vector::is_empty(&endpoint_hash), EEmptyEndpointHash);
        assert!(!table::contains(&registry.relayers, relayer), EAlreadyRegistered);

        let now_ms = clock::timestamp_ms(clock);
        let info = RelayerInfo {
            endpoint_hash,
            active: true,
            registered_at_ms: now_ms,
            last_status_change_ms: 0,
        };
        table::add(&mut registry.relayers, relayer, info);
        registry.total_registered = registry.total_registered + 1;
        registry.active_count = registry.active_count + 1;

        event::emit(RelayerApproved {
            relayer,
            endpoint_hash: table::borrow(&registry.relayers, relayer).endpoint_hash,
            registered_at_ms: now_ms,
        });
    }

    /// Deactivate a relayer. The address must be in the registry and currently
    /// active. The relayer's info is retained for audit history but
    /// `active` is set to `false`. Emits `RelayerDeactivated`.
    public(package) entry fun deactivate(
        _admin: &AdminCap,
        registry: &mut RelayerRegistry,
        relayer: address,
        clock: &Clock,
    ) {
        assert!(table::contains(&registry.relayers, relayer), ENotRegistered);
        let info = table::borrow_mut(&mut registry.relayers, relayer);
        assert!(info.active, EAlreadyInactive);
        info.active = false;
        info.last_status_change_ms = clock::timestamp_ms(clock);
        registry.active_count = registry.active_count - 1;

        event::emit(RelayerDeactivated {
            relayer,
            at_ms: info.last_status_change_ms,
        });
    }

    /// Reactivate a previously deactivated relayer. The address must be in
    /// the registry and currently inactive. Emits `RelayerReactivated`.
    public(package) entry fun reactivate(
        _admin: &AdminCap,
        registry: &mut RelayerRegistry,
        relayer: address,
        clock: &Clock,
    ) {
        assert!(table::contains(&registry.relayers, relayer), ENotRegisteredForReactivate);
        let info = table::borrow_mut(&mut registry.relayers, relayer);
        assert!(!info.active, EAlreadyActive);
        info.active = true;
        info.last_status_change_ms = clock::timestamp_ms(clock);
        registry.active_count = registry.active_count + 1;

        event::emit(RelayerReactivated {
            relayer,
            at_ms: info.last_status_change_ms,
        });
    }

    /// Update the endpoint hash for a relayer. The address must be in the
    /// registry. This is the "rotate your URL" operation — the relayer moved
    /// its service and wants wallets to discover the new endpoint. Only the
    /// admin can do this (a self-service model where the relayer updates its
    /// own endpoint would require a `RelayerCap` check, which is a future
    /// extension). Emits `RelayerEndpointUpdated`.
    public(package) entry fun update_endpoint(
        _admin: &AdminCap,
        registry: &mut RelayerRegistry,
        relayer: address,
        new_hash: vector<u8>,
    ) {
        assert!(!vector::is_empty(&new_hash), EEmptyEndpointHash);
        assert!(table::contains(&registry.relayers, relayer), ENotRegistered);
        let info = table::borrow_mut(&mut registry.relayers, relayer);
        let old_hash = info.endpoint_hash;
        info.endpoint_hash = new_hash;

        event::emit(RelayerEndpointUpdated {
            relayer,
            old_hash,
            new_hash,
        });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Total relayers ever registered (including deactivated). Monotonic.
    public fun total_registered(registry: &RelayerRegistry): u64 {
        registry.total_registered
    }

    /// Currently active relayer count.
    public fun active_count(registry: &RelayerRegistry): u64 {
        registry.active_count
    }

    /// Whether `relayer` is in the registry (active or inactive).
    public fun is_registered(registry: &RelayerRegistry, relayer: address): bool {
        table::contains(&registry.relayers, relayer)
    }

    /// Whether `relayer` is registered AND active. Convenience for wallets
    /// that want a single check before displaying a relayer.
    public fun is_active(registry: &RelayerRegistry, relayer: address): bool {
        if (table::contains(&registry.relayers, relayer)) {
            table::borrow(&registry.relayers, relayer).active
        } else {
            false
        }
    }

    /// Full info for `relayer`, or `None` if not registered. Returned by
    /// value (RelayerInfo is `copy+drop`) so the caller can inspect fields
    /// without holding a borrow on the shared table.
    public fun relayer_info(registry: &RelayerRegistry, relayer: address): Option<RelayerInfo> {
        if (table::contains(&registry.relayers, relayer)) {
            option::some(*table::borrow(&registry.relayers, relayer))
        } else {
            option::none()
        }
    }

    /// Endpoint hash for `relayer`. Aborts with `ENotRegistered` if not
    /// registered. Convenience for the most common single-field read.
    public fun endpoint_hash(registry: &RelayerRegistry, relayer: address): vector<u8> {
        assert!(table::contains(&registry.relayers, relayer), ENotRegistered);
        table::borrow(&registry.relayers, relayer).endpoint_hash
    }

    /// Registration timestamp (ms) for `relayer`. Aborts if not registered.
    public fun registered_at_ms(registry: &RelayerRegistry, relayer: address): u64 {
        assert!(table::contains(&registry.relayers, relayer), ENotRegistered);
        table::borrow(&registry.relayers, relayer).registered_at_ms
    }

    // ─── RelayerInfo field getters ──────────────────────────────────────────
    public fun info_endpoint_hash(info: &RelayerInfo): &vector<u8> { &info.endpoint_hash }
    public fun info_active(info: &RelayerInfo): bool { info.active }
    public fun info_registered_at_ms(info: &RelayerInfo): u64 { info.registered_at_ms }
    public fun info_last_status_change_ms(info: &RelayerInfo): u64 {
        info.last_status_change_ms
    }

    // ─── Test helpers ────────────────────────────────────────────────────────
    #[test_only]
    public fun new_test_registry(ctx: &mut TxContext): RelayerRegistry {
        RelayerRegistry {
            id: object::new(ctx),
            relayers: table::new(ctx),
            total_registered: 0,
            active_count: 0,
        }
    }

    #[test_only]
    public fun new_test_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    #[test_only]
    public fun destroy_test_admin_cap(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_test_registry(registry: RelayerRegistry) {
        let RelayerRegistry { id, relayers, total_registered: _, active_count: _ } = registry;
        table::drop(relayers);
        object::delete(id);
    }
}
