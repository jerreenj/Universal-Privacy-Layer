# Sui Privacy Layer - Deployment Guide

## Prerequisites

### 1. Install Sui CLI
```bash
# macOS
brew install sui

# Linux (x86_64)
curl -fLJO https://github.com/MystenLabs/sui/releases/latest/download/sui-mainnet-linux-x86_64.tar.gz
tar -xvf sui-mainnet-linux-x86_64.tar.gz
sudo mv sui /usr/local/bin/

# Verify
sui --version
```

### 2. Configure Wallet
```bash
# Create new Sui config
sui client new-env --alias mainnet --rpc https://fullnode.mainnet.sui.io:443
sui client switch --env mainnet

# Import existing wallet (from seed)
# Option 1: Interactive recovery
sui keytool import "<SEED_PHRASE>" ed25519

# Option 2: Generate new wallet (recommended for production)
sui client new-address ed25519

# Set active address
sui client switch --address 0xYOUR_ADDRESS

# Check balance
sui client balance
```

## Deployment Steps

### 1. Navigate to Package
```bash
cd /path/to/contracts/sui/privacy_layer
```

### 2. Verify Package Structure
```
privacy_layer/
├── Move.toml
└── sources/
    ├── privacy_relayer.move
    └── stealth_address_registry.move
```

### 3. Build the Package
```bash
sui move build
```

### 4. Run Tests (Optional)
```bash
sui move test
```

### 5. Deploy to Mainnet
```bash
# Publish with auto-gas calculation
sui client publish --gas-budget 100000000

# This will output:
# - Package ID (save this!)
# - Transaction digest
# - Created objects
```

### 6. Save the Package ID
```
╭─────────────────────────────────────────────────────────────────────────╮
│ Published Objects                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ PackageID: 0x1234...abcd                                                │
╰─────────────────────────────────────────────────────────────────────────╯
```

### 7. Initialize the Contracts

```typescript
// Using @mysten/sui.js
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';

const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
const PACKAGE_ID = "0xYOUR_PACKAGE_ID";

// Create keypair from seed
const keypair = Ed25519Keypair.deriveKeypair("your seed phrase here");

// Initialize Privacy Relayer
async function initializeRelayer() {
  const tx = new TransactionBlock();
  
  tx.moveCall({
    target: `${PACKAGE_ID}::privacy_relayer::initialize`,
    arguments: [
      tx.pure(5), // fee basis points (0.05%)
    ],
  });
  
  const result = await client.signAndExecuteTransactionBlock({
    signer: keypair,
    transactionBlock: tx,
  });
  
  console.log("Relayer initialized:", result.digest);
}

initializeRelayer();
```

## Update Application Config

### Backend (`/app/backend/server.py`)
```python
SUI_CONFIG = {
    "package_id": "0xYOUR_DEPLOYED_PACKAGE_ID",
    "relayer_object": "0xRELAYER_OBJECT_ID",
    "registry_object": "0xREGISTRY_OBJECT_ID",
}
```

### Frontend (`/app/frontend/src/App.js`)
```javascript
sui: { 
  // ...
  contracts: { packageId: "0xYOUR_DEPLOYED_PACKAGE_ID" } 
}
```

## Estimated Costs

| Action | Cost (SUI) |
|--------|------------|
| Package Publish | ~0.1 SUI |
| Initialize | ~0.01 SUI |
| Relay Payment | ~0.001 SUI |
| Register Keys | ~0.005 SUI |

## Funded Deployer Address

The wallet with funds is:
```
Address: 0xfde77f3867fd0ab7c76fcebc4f0190460d80dc9d1da016bda033e675cb99ff35
Balance: ~3.16 SUI (as of last check)
```

To use this wallet, import the seed phrase using `sui keytool import`.

## Troubleshooting

### "Insufficient gas"
```bash
# Check balance
sui client balance

# Get more SUI or reduce gas budget
sui client publish --gas-budget 50000000
```

### "Package already exists"
Sui packages are immutable. Deploy a new version with `sui client upgrade`.

### Build errors
```bash
# Check dependencies in Move.toml
# Ensure Sui framework version matches
sui move build --fetch-deps-only
sui move build
```

### "No valid gas coins"
```bash
# Merge small coin objects
sui client merge-coin --primary-coin <MAIN_COIN_ID> --coin-to-merge <SMALL_COIN_ID>
```

## Security Notes

- Generate a fresh wallet for production deployments
- The existing deployer seed phrase is documented and should be considered compromised
- Always verify package hash before trusting a deployment
- Test thoroughly on testnet before mainnet deployment
