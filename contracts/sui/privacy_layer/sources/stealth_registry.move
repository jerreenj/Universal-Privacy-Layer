/// Universal Privacy Layer - Stealth Address Registry Module
/// Registers stealth meta-addresses and ephemeral key announcements on Sui
module privacy_layer::stealth_registry {
    use sui::event;
    use sui::table::{Self, Table};

    // ===== Errors =====
    const EAlreadyRegistered: u64 = 1;
    const EInvalidKey: u64 = 2;
    const ENotRegistered: u64 = 3;

    // ===== Structs =====

    /// Shared registry — everyone reads from this
    public struct StealthRegistry has key {
        id: UID,
        total_registrations: u64,
        total_announcements: u64,
        // maps address -> meta-address bytes
        registrations: Table<address, vector<u8>>,
    }

    // ===== Events =====

    public struct StealthMetaAddressSet has copy, drop {
        registrant: address,
        spend_pub_key: vector<u8>,
        view_pub_key: vector<u8>,
    }

    public struct EphemeralKeyAnnouncement has copy, drop {
        sender: address,
        stealth_address: address,
        ephemeral_pub_key: vector<u8>,
        view_tag: u8,
        timestamp: u64,
    }

    // ===== Init =====

    fun init(ctx: &mut TxContext) {
        let registry = StealthRegistry {
            id: object::new(ctx),
            total_registrations: 0,
            total_announcements: 0,
            registrations: table::new(ctx),
        };
        transfer::share_object(registry);
    }

    // ===== Public Functions =====

    /// Register a stealth meta-address (spend + view public keys)
    /// Call this once to let others send you private payments
    public entry fun register_stealth_meta_address(
        registry: &mut StealthRegistry,
        spend_pub_key: vector<u8>,
        view_pub_key: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&spend_pub_key) == 33 || vector::length(&spend_pub_key) == 64, EInvalidKey);
        assert!(vector::length(&view_pub_key) == 33 || vector::length(&view_pub_key) == 64, EInvalidKey);

        let caller = ctx.sender();

        // Combine keys as meta-address
        let mut meta_address = spend_pub_key;
        vector::append(&mut meta_address, view_pub_key);

        if (table::contains(&registry.registrations, caller)) {
            // Update existing registration
            *table::borrow_mut(&mut registry.registrations, caller) = meta_address;
        } else {
            table::add(&mut registry.registrations, caller, meta_address);
            registry.total_registrations = registry.total_registrations + 1;
        };

        event::emit(StealthMetaAddressSet {
            registrant: caller,
            spend_pub_key,
            view_pub_key,
        });
    }

    /// Announce an ephemeral key after sending to a stealth address
    /// This lets the recipient scan and find their payment
    public entry fun announce_ephemeral_key(
        registry: &mut StealthRegistry,
        stealth_address: address,
        ephemeral_pub_key: vector<u8>,
        view_tag: u8,
        clock: &sui::clock::Clock,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&ephemeral_pub_key) == 33 || vector::length(&ephemeral_pub_key) == 64, EInvalidKey);

        registry.total_announcements = registry.total_announcements + 1;

        event::emit(EphemeralKeyAnnouncement {
            sender: ctx.sender(),
            stealth_address,
            ephemeral_pub_key,
            view_tag,
            timestamp: sui::clock::timestamp_ms(clock),
        });
    }

    // ===== View Functions =====

    public fun is_registered(registry: &StealthRegistry, user: address): bool {
        table::contains(&registry.registrations, user)
    }

    public fun get_meta_address(registry: &StealthRegistry, user: address): &vector<u8> {
        assert!(table::contains(&registry.registrations, user), ENotRegistered);
        table::borrow(&registry.registrations, user)
    }

    public fun total_registrations(registry: &StealthRegistry): u64 {
        registry.total_registrations
    }

    public fun total_announcements(registry: &StealthRegistry): u64 {
        registry.total_announcements
    }
}
