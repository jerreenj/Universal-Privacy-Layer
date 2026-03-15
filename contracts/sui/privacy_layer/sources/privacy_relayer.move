/// Universal Privacy Layer - Privacy Relayer Module
/// Enables private transaction routing via stealth addresses on Sui
module privacy_layer::privacy_relayer {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};

    // ===== Errors =====
    const EInsufficientFee: u64 = 1;
    const ENotOwner: u64 = 2;
    const EZeroAmount: u64 = 3;

    // Fee in MIST (0.05% = 5 basis points)
    const FEE_BPS: u64 = 5;
    const BPS_DENOM: u64 = 10000;

    // ===== Structs =====

    /// Shared relayer object — holds config and collected fees
    public struct PrivacyRelayer has key {
        id: UID,
        owner: address,
        fee_bps: u64,
        total_relayed: u64,
        fees_collected: Balance<SUI>,
    }

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    // ===== Events =====

    public struct PrivateTransferEvent has copy, drop {
        ephemeral_key: vector<u8>,
        stealth_address: address,
        amount: u64,
        timestamp: u64,
    }

    public struct FeeCollectedEvent has copy, drop {
        fee_amount: u64,
        relayer: address,
    }

    // ===== Init =====

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };

        let relayer = PrivacyRelayer {
            id: object::new(ctx),
            owner: ctx.sender(),
            fee_bps: FEE_BPS,
            total_relayed: 0,
            fees_collected: balance::zero(),
        };

        transfer::share_object(relayer);
        transfer::transfer(admin_cap, ctx.sender());
    }

    // ===== Public Functions =====

    /// Relay a private payment to a stealth address
    /// ephemeral_key: one-time public key for recipient to scan
    /// stealth_address: the recipient's stealth address
    public entry fun relay_payment(
        relayer: &mut PrivacyRelayer,
        payment: Coin<SUI>,
        stealth_address: address,
        ephemeral_key: vector<u8>,
        clock: &sui::clock::Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);

        // Calculate fee
        let fee_amount = (amount * relayer.fee_bps) / BPS_DENOM;
        let transfer_amount = amount - fee_amount;

        // Split fee from payment
        let mut payment_mut = payment;
        let fee_coin = coin::split(&mut payment_mut, fee_amount, ctx);

        // Add fee to relayer balance
        balance::join(&mut relayer.fees_collected, coin::into_balance(fee_coin));
        relayer.total_relayed = relayer.total_relayed + transfer_amount;

        // Send remainder to stealth address
        transfer::public_transfer(payment_mut, stealth_address);

        // Emit event (allows recipient scanning)
        event::emit(PrivateTransferEvent {
            ephemeral_key,
            stealth_address,
            amount: transfer_amount,
            timestamp: sui::clock::timestamp_ms(clock),
        });

        event::emit(FeeCollectedEvent {
            fee_amount,
            relayer: ctx.sender(),
        });
    }

    /// Withdraw collected fees (owner only)
    public entry fun withdraw_fees(
        relayer: &mut PrivacyRelayer,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let amount = balance::value(&relayer.fees_collected);
        assert!(amount > 0, EInsufficientFee);
        let fees = coin::from_balance(
            balance::split(&mut relayer.fees_collected, amount),
            ctx,
        );
        transfer::public_transfer(fees, relayer.owner);
    }

    // ===== View Functions =====

    public fun total_relayed(relayer: &PrivacyRelayer): u64 {
        relayer.total_relayed
    }

    public fun fees_collected(relayer: &PrivacyRelayer): u64 {
        balance::value(&relayer.fees_collected)
    }

    public fun fee_bps(relayer: &PrivacyRelayer): u64 {
        relayer.fee_bps
    }
}
