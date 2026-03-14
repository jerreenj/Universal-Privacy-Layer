# UPL Smart Contracts

## Contracts

### 1. PrivacyRelayer.sol
Main privacy relayer contract for private ETH transfers.

**Features:**
- Private send to stealth addresses
- Batch transfers
- 0.05% fee (configurable)
- View tag registry

### 2. StealthAddressRegistry.sol
Registry for stealth address announcements.

**Features:**
- Ephemeral public key storage
- View tag indexing
- Range scanning for efficient sync

### 3. UniswapPrivacyWrapper.sol
Privacy wrapper for Uniswap V3 swaps.

**Features:**
- Private ETH → Token swaps
- Private Token → ETH swaps
- Private Token → Token swaps
- Minimal event emission for privacy

## Deployment

### Prerequisites
1. Get testnet ETH from faucets:
   - Ethereum Sepolia: https://www.alchemy.com/faucets/ethereum-sepolia
   - Arbitrum Sepolia: https://www.alchemy.com/faucets/arbitrum-sepolia
   - Base Sepolia: https://www.coinbase.com/faucets

2. Install dependencies:
   ```bash
   npm install @openzeppelin/contracts hardhat
   ```

### Deploy
```bash
# Set deployer mnemonic
export DEPLOYER_MNEMONIC="your seed phrase here"

# Deploy to Base Sepolia (cheapest gas)
export DEPLOY_CHAIN=base_sepolia
python deploy.py
```

## Contract Addresses (After Deployment)

| Chain | PrivacyRelayer | StealthRegistry | UniswapWrapper |
|-------|----------------|-----------------|----------------|
| Ethereum Sepolia | TBD | TBD | TBD |
| Arbitrum Sepolia | TBD | TBD | TBD |
| Base Sepolia | TBD | TBD | TBD |

## Uniswap V3 Router Addresses

| Chain | Router | WETH |
|-------|--------|------|
| Ethereum Sepolia | 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E | 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14 |
| Arbitrum Sepolia | 0x101F443B4d1b059569D643917553c771E1b9663E | 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73 |
| Base Sepolia | 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 | 0x4200000000000000000000000000000000000006 |

## Security Notes

1. **Non-Custodial**: Contracts never hold user funds
2. **Stateless**: No user data stored on-chain
3. **Auditable**: Open source, simple logic
4. **Upgradeable**: Owner can update fee rates only
