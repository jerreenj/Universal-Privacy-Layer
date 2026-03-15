# Solana Privacy Layer - Deployment Guide

## Prerequisites

### 1. Install Solana CLI
```bash
# macOS/Linux
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify
solana --version
```

### 2. Install Anchor
```bash
# Install Anchor Version Manager
cargo install --git https://github.com/coral-xyz/anchor avm --locked

# Install latest Anchor
avm install latest
avm use latest

# Verify
anchor --version
```

### 3. Configure Wallet
```bash
# SECURITY: Never write seed phrases to files or commit them to repositories!
# Generate a new wallet OR import existing using Solana CLI interactively:

# Option 1: Create new wallet
solana-keygen new --outfile ~/.config/solana/upl-deployer.json

# Option 2: Import existing wallet (interactive - will prompt for seed phrase)
solana-keygen recover --outfile ~/.config/solana/upl-deployer.json

# Set as default
solana config set --keypair ~/.config/solana/upl-deployer.json

# Configure for mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Check balance (need ~0.5 SOL for deployment)
solana balance
```

## Deployment Steps

### 1. Clone/Copy the Program
```bash
# Navigate to contracts directory
cd /path/to/contracts/solana/privacy_layer

# Verify structure
ls -la
# Should show:
# - Cargo.toml
# - src/lib.rs
```

### 2. Build the Program
```bash
# Build
anchor build

# This creates:
# - target/deploy/privacy_layer.so (compiled program)
# - target/idl/privacy_layer.json (interface definition)
```

### 3. Get Program ID
```bash
# Generate program keypair (or use existing)
solana-keygen new -o target/deploy/privacy_layer-keypair.json

# Get the program ID
solana address -k target/deploy/privacy_layer-keypair.json
# Output: UPLreLaYer1111111111111111111111111111111111 (example)
```

### 4. Update lib.rs
Update the `declare_id!` in `src/lib.rs` with your actual program ID:
```rust
declare_id!("YOUR_ACTUAL_PROGRAM_ID_HERE");
```

Then rebuild:
```bash
anchor build
```

### 5. Deploy to Mainnet
```bash
# Deploy (costs ~0.5 SOL)
anchor deploy --provider.cluster mainnet

# Or using solana CLI directly
solana program deploy target/deploy/privacy_layer.so
```

### 6. Initialize the Program
```javascript
// Using @coral-xyz/anchor in Node.js
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(/* your secret key */);

const provider = new anchor.AnchorProvider(connection, wallet, {});
anchor.setProvider(provider);

const program = anchor.workspace.PrivacyLayer;

// Initialize
const [relayerPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("privacy_relayer")],
  program.programId
);
const [feeVaultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_vault")],
  program.programId
);

await program.methods
  .initialize(new anchor.BN(5)) // 0.05% fee
  .accounts({
    relayer: relayerPDA,
    feeVault: feeVaultPDA,
    owner: wallet.publicKey,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();

console.log("Privacy Layer initialized!");
```

## Program ID

After deployment, update these files with your deployed program ID:

1. **Backend**: `/app/backend/server.py`
```python
SOLANA_PROGRAM_ID = "YOUR_DEPLOYED_PROGRAM_ID"
```

2. **Frontend**: `/app/frontend/src/App.js`
```javascript
solana: { 
  // ...
  contracts: { programId: "YOUR_DEPLOYED_PROGRAM_ID" } 
}
```

## Testing

### Test on Devnet First
```bash
# Switch to devnet
solana config set --url devnet

# Airdrop SOL for testing
solana airdrop 2

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Test the program
anchor test
```

## Estimated Costs

| Action | Cost (SOL) |
|--------|------------|
| Program Deployment | ~0.5 SOL |
| Initialize | ~0.01 SOL |
| Relay Payment | ~0.002 SOL |
| Register Keys | ~0.005 SOL |

## Troubleshooting

### "Insufficient funds"
```bash
solana balance
# If < 0.5 SOL, send more to your deployer address
```

### "Program already deployed"
```bash
# Upgrade existing program
solana program deploy target/deploy/privacy_layer.so --program-id <EXISTING_ID>
```

### Build errors
```bash
# Clear cache and rebuild
anchor clean
anchor build
```

## Security Notes

- The deployer wallet seed phrase is compromised (in documentation). Generate a new wallet for production!
- Always test on devnet before mainnet
- Audit the program before handling real funds
