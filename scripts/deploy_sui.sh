#!/bin/bash
# =============================================================================
# SUI PRIVACY LAYER - ONE-CLICK DEPLOYMENT SCRIPT
# =============================================================================
# Run this script on your local machine (macOS/Linux x86_64)
# Prerequisites: curl, git
# =============================================================================

set -e

echo "=========================================="
echo "  Sui Privacy Layer Deployment Script"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Config - SECURITY: Use environment variables for sensitive data
# Never hardcode seed phrases! Set these before running:
# export DEPLOYER_SEED="your seed phrase here"
# export SUI_ADDRESS="your sui address here"
if [ -z "$DEPLOYER_SEED" ]; then
    echo -e "${RED}ERROR: DEPLOYER_SEED environment variable is required!${NC}"
    echo "Usage: export DEPLOYER_SEED='your twelve word seed phrase here'"
    exit 1
fi
if [ -z "$SUI_ADDRESS" ]; then
    echo -e "${YELLOW}WARNING: SUI_ADDRESS not set. Will use recovered address.${NC}"
fi

# Step 1: Install Sui CLI if not present
install_sui() {
    if command -v sui &> /dev/null; then
        echo -e "${GREEN}✓ Sui CLI already installed${NC}"
        sui --version
        return
    fi
    
    echo -e "${YELLOW}Installing Sui CLI...${NC}"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew install sui
    else
        # Linux
        curl -sSfL https://raw.githubusercontent.com/MystenLabs/suiup/main/install.sh | sh
        export PATH="$HOME/.sui/bin:$PATH"
    fi
    
    echo -e "${GREEN}✓ Sui CLI installed${NC}"
    sui --version
}

# Step 2: Configure wallet
setup_wallet() {
    echo ""
    echo -e "${YELLOW}Setting up wallet...${NC}"
    
    # Create config directory
    mkdir -p ~/.sui/sui_config
    
    # Import wallet from seed phrase
    echo "$DEPLOYER_SEED" | sui keytool import --derivation-path "m/44'/784'/0'/0'/0'" ed25519 2>/dev/null || true
    
    # Set active address
    sui client switch --address "$SUI_ADDRESS" 2>/dev/null || true
    
    # Configure mainnet
    sui client new-env --alias mainnet --rpc https://fullnode.mainnet.sui.io:443 2>/dev/null || true
    sui client switch --env mainnet
    
    echo -e "${GREEN}✓ Wallet configured${NC}"
    echo "Address: $SUI_ADDRESS"
    sui client balance
}

# Step 3: Create Move package
create_package() {
    echo ""
    echo -e "${YELLOW}Creating Move package...${NC}"
    
    # Create directory structure
    mkdir -p sui_privacy_layer/sources
    
    # Write Move.toml
    cat > sui_privacy_layer/Move.toml << 'MOVETOML'
[package]
name = "privacy_layer"
edition = "2024.beta"
version = "0.0.1"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/mainnet" }

[addresses]
privacy_layer = "0x0"
MOVETOML

    # Write privacy_relayer.move
    cat > sui_privacy_layer/sources/privacy_relayer.move << 'RELAYER'
module privacy_layer::privacy_relayer {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};

    const EZeroAmount: u64 = 3;
    const FEE_BPS: u64 = 5;
    const BPS_DENOM: u64 = 10000;

    public struct PrivacyRelayer has key {
        id: UID,
        owner: address,
        fee_bps: u64,
        total_relayed: u64,
        fees_collected: Balance<SUI>,
    }

    public struct AdminCap has key, store { id: UID }

    public struct PrivateTransferEvent has copy, drop {
        ephemeral_key: vector<u8>,
        stealth_address: address,
        amount: u64,
        timestamp: u64,
    }

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
        let fee_amount = (amount * relayer.fee_bps) / BPS_DENOM;
        let transfer_amount = amount - fee_amount;
        let mut payment_mut = payment;
        let fee_coin = coin::split(&mut payment_mut, fee_amount, ctx);
        balance::join(&mut relayer.fees_collected, coin::into_balance(fee_coin));
        relayer.total_relayed = relayer.total_relayed + transfer_amount;
        transfer::public_transfer(payment_mut, stealth_address);
        event::emit(PrivateTransferEvent {
            ephemeral_key,
            stealth_address,
            amount: transfer_amount,
            timestamp: sui::clock::timestamp_ms(clock),
        });
    }

    public entry fun withdraw_fees(relayer: &mut PrivacyRelayer, _cap: &AdminCap, ctx: &mut TxContext) {
        let amount = balance::value(&relayer.fees_collected);
        let fees = coin::from_balance(balance::split(&mut relayer.fees_collected, amount), ctx);
        transfer::public_transfer(fees, relayer.owner);
    }
}
RELAYER

    # Write stealth_registry.move
    cat > sui_privacy_layer/sources/stealth_registry.move << 'REGISTRY'
module privacy_layer::stealth_registry {
    use sui::event;
    use sui::table::{Self, Table};

    const EInvalidKey: u64 = 2;
    const ENotRegistered: u64 = 3;

    public struct StealthRegistry has key {
        id: UID,
        total_registrations: u64,
        total_announcements: u64,
        registrations: Table<address, vector<u8>>,
    }

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

    fun init(ctx: &mut TxContext) {
        let registry = StealthRegistry {
            id: object::new(ctx),
            total_registrations: 0,
            total_announcements: 0,
            registrations: table::new(ctx),
        };
        transfer::share_object(registry);
    }

    public entry fun register_stealth_meta_address(
        registry: &mut StealthRegistry,
        spend_pub_key: vector<u8>,
        view_pub_key: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&spend_pub_key) == 33 || vector::length(&spend_pub_key) == 64, EInvalidKey);
        assert!(vector::length(&view_pub_key) == 33 || vector::length(&view_pub_key) == 64, EInvalidKey);
        let caller = ctx.sender();
        let mut meta_address = spend_pub_key;
        vector::append(&mut meta_address, view_pub_key);
        if (table::contains(&registry.registrations, caller)) {
            *table::borrow_mut(&mut registry.registrations, caller) = meta_address;
        } else {
            table::add(&mut registry.registrations, caller, meta_address);
            registry.total_registrations = registry.total_registrations + 1;
        };
        event::emit(StealthMetaAddressSet { registrant: caller, spend_pub_key, view_pub_key });
    }

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

    public fun is_registered(registry: &StealthRegistry, user: address): bool {
        table::contains(&registry.registrations, user)
    }
}
REGISTRY

    echo -e "${GREEN}✓ Move package created${NC}"
}

# Step 4: Build and deploy
deploy() {
    echo ""
    echo -e "${YELLOW}Building and deploying...${NC}"
    
    cd sui_privacy_layer
    
    # Build
    echo "Building..."
    sui move build
    
    # Deploy
    echo ""
    echo -e "${YELLOW}Deploying to Sui Mainnet...${NC}"
    echo "This will cost approximately 0.1 SUI"
    echo ""
    read -p "Press Enter to continue or Ctrl+C to cancel..."
    
    # Publish
    RESULT=$(sui client publish --gas-budget 200000000 --json)
    
    # Extract package ID
    PACKAGE_ID=$(echo "$RESULT" | grep -o '"packageId":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    echo ""
    echo -e "${GREEN}=========================================="
    echo "  DEPLOYMENT SUCCESSFUL!"
    echo "==========================================${NC}"
    echo ""
    echo -e "Package ID: ${YELLOW}$PACKAGE_ID${NC}"
    echo ""
    echo "Update your frontend App.js with:"
    echo "  sui: { contracts: { packageId: \"$PACKAGE_ID\" } }"
    echo ""
    echo "View on explorer:"
    echo "  https://suiexplorer.com/object/$PACKAGE_ID"
    
    cd ..
}

# Main
main() {
    install_sui
    setup_wallet
    create_package
    deploy
}

main
