# UPL SDK

Universal Privacy Layer SDK for private transactions across 7 EVM chains.

## Installation

### JavaScript/TypeScript
```bash
npm install @upl/sdk
# or
yarn add @upl/sdk
```

### Python
```bash
pip install upl-sdk
```

## Quick Start

### JavaScript
```typescript
import { UPL } from '@upl/sdk';

const upl = new UPL();

// Create privacy wallet
const wallet = await upl.createPrivacyWallet();

// Generate stealth address for receiving
const stealth = await upl.generateStealthAddress(
  wallet.spending_public_key,
  wallet.viewing_public_key
);

console.log('Send funds to:', stealth.stealth_address);

// Get hidden balance
const balance = await upl.getHiddenBalance('0x...');

// Prepare cross-chain split
const splitPlan = await upl.prepareSplit('0x...', '0.1', [
  { chain: 'base', stealth_address: '0x...', percentage: 50 },
  { chain: 'arbitrum', stealth_address: '0x...', percentage: 50 },
]);
```

### Python
```python
from upl_sdk import UPL

upl = UPL()

# Create privacy wallet
wallet = upl.create_privacy_wallet()

# Generate stealth address
stealth = upl.generate_stealth_address(
    wallet.spending_public_key,
    wallet.viewing_public_key
)

print(f"Send funds to: {stealth.stealth_address}")

# Get hidden balance
balance = upl.get_hidden_balance("0x...")

# Prepare cross-chain split
split_plan = upl.prepare_split("0x...", "0.1", [
    {"chain": "base", "stealth_address": "0x...", "percentage": 50},
    {"chain": "arbitrum", "stealth_address": "0x...", "percentage": 50},
])
```

## Supported Chains

| Chain | Symbol | Chain ID |
|-------|--------|----------|
| Base | ETH | 8453 |
| Arbitrum | ETH | 42161 |
| Polygon | POL | 137 |
| Optimism | ETH | 10 |
| BNB Chain | BNB | 56 |
| Avalanche | AVAX | 43114 |
| Hyperliquid | HYPE | 999 |

## API Reference

### `createPrivacyWallet()` / `create_privacy_wallet()`
Creates a new privacy wallet with spending and viewing key pairs.

### `generateStealthAddress(spendingKey, viewingKey)` / `generate_stealth_address(spending_key, viewing_key)`
Generates a one-time stealth address for private receiving.

### `getBalance(address, chain)` / `get_balance(address, chain)`
Gets balance for an address on a specific chain.

### `getHiddenBalance(address)` / `get_hidden_balance(address)`
Gets aggregated balance across all stealth addresses.

### `prepareSplit(from, amount, splits)` / `prepare_split(from_addr, amount, splits)`
Prepares a cross-chain split transaction.

### `verifyZKP(proof, inputs, type, chain)` / `verify_zkp(proof, inputs, type, chain)`
Verifies a zero-knowledge proof on-chain.

## Authentication

For higher rate limits, use an API key:

```typescript
const upl = new UPL({ apiKey: 'your-api-key' });
```

```python
upl = UPL(api_key="your-api-key")
```

Get your API key at: https://privacycloak.in/developer

## License

MIT
