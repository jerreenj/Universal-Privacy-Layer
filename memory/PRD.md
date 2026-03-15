# Universal Privacy Layer (UPL) - PRD

**Last Updated:** December 2025

## SECURITY UPDATE (December 2025)
⚠️ **CRITICAL:** The old deployer wallet was compromised. All deployment scripts have been secured.

### New Deployer Wallet
```
Address: 0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4
```
**IMPORTANT:** The seed phrase is NEVER stored in code. Always use environment variables:
```bash
export DEPLOYER_MNEMONIC='your twelve word seed phrase here'
```

### Old Wallet (COMPROMISED - DO NOT USE)
```
Address: 0x92b4c9BF1fFa6D7e... (drained)
```

## OVERVIEW
Universal Privacy Layer provides private transactions across 7 EVM chains with ZKP verification, stealth addresses, and cross-chain privacy splitting.

## LATEST UPDATE (December 2025)

### Newly Implemented Features

#### 1. Cross-Chain Privacy Splitting (Enhanced) ✅
- Full frontend UI with execution tracking
- Auto-generate stealth addresses for splits
- Auto-distribute percentages
- Execute individual or all splits
- Chain switching support
- Transaction status tracking (pending/confirming/confirmed/failed)

#### 2. PWA (Progressive Web App) ✅
- Installable on iOS/Android devices
- Service worker for offline support
- Push notification support
- Background sync for pending transactions
- App manifest with icons

#### 3. Developer API ✅
- **Documentation endpoint:** `GET /api/v1/docs`
- **API Key Management:**
  - Create keys: `POST /api/developer/keys/create`
  - List keys: `GET /api/developer/keys/{address}`
  - Revoke keys: `DELETE /api/developer/keys/{key_name}`
  - Usage stats: `GET /api/developer/usage/{address}`
- **Public API endpoints:**
  - `GET /api/v1/chains` - List supported chains
  - `POST /api/v1/stealth/generate` - Generate stealth addresses
- **Rate limiting:** 100 req/min default, customizable per key

#### 4. React Native Mobile App ✅
- Complete project structure in `/app/mobile/`
- Full wallet integration with hooks
- All screens: Home, Receive, Send, Split, History, Setup
- API service layer for backend communication
- Async storage for privacy wallet persistence
- Chain selector and balance display

#### 5. SDKs (@upl/sdk, upl-sdk) ✅
**JavaScript/TypeScript SDK** (`/app/sdk/js/`):
- `npm install @upl/sdk`
- Full TypeScript support
- Privacy wallet creation/import
- Stealth address generation
- Cross-chain split preparation
- ZKP verification
- Transaction history

**Python SDK** (`/app/sdk/python/`):
- `pip install upl-sdk`
- Dataclass models for type safety
- Web3.py integration
- All API endpoints covered

#### 6. Code Refactoring ✅
- Extracted config to `/app/frontend/src/config/chains.js`
- Extracted WalletContext to `/app/frontend/src/context/WalletContext.jsx`
- Fixed all bare `except` statements in backend (10 lint warnings resolved)
- App.js now imports from modular files

## DEPLOYED CONTRACTS

### Privacy Relayer (All 7 Chains)
```
Address: 0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c
```

### Stealth Registry (All 7 Chains)
```
Address: 0xf2E7A6734E58774A8417c176AaE3898667699Ff4
```

### ZKP Verifier Contracts (Newly Deployed)
| Chain | Address |
|-------|---------|
| Base | 0x98940B431d829832d2Ad5eB0812824A3C40D1bF1 |
| Arbitrum | 0xbdFc25A62dcCFbc710072Ae2EaE5c3a57674bDad |
| Polygon | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Optimism | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| BNB Chain | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Avalanche | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Hyperliquid | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |

## IMPLEMENTED FEATURES (100%)

### Core Features
- ✅ Private Receive (Stealth Addresses)
- ✅ Private Send
- ✅ Private Swap
- ✅ Hidden Wallet Balance (Aggregated)
- ✅ Dual Seed Phrase System
- ✅ Transaction History

### Advanced Features  
- ✅ **ZKP Proofs** - On-chain verification via deployed UPLVerifier contracts
- ✅ **On-Chain Relayer** - Route through PrivacyRelayer contract
- ✅ **Cross-Chain Split** - Split payments across multiple chains
- ✅ **Encrypted Messaging** - E2E encrypted messages
- ✅ **Multisig Privacy** - Off-chain signature collection

### Extra Tools
- ✅ NFT Privacy Proxy
- ✅ Token Approval Privacy
- ✅ Contract Privacy Proxy
- ✅ Chain Status Dashboard

## ZKP CIRCUITS

Located at `/app/circuits/sources/`:
- `stealth_ownership.circom` - Prove stealth address ownership
- `amount_range.circom` - Prove amount is in valid range
- `membership.circom` - Prove Merkle tree membership

### Build Instructions
```bash
# On local machine (x86_64)
cd /app/circuits
./build_circuits.sh
```

This generates:
- R1CS constraint files
- WASM for browser proof generation
- Proving/Verification keys
- Solidity verifier contracts

## API ENDPOINTS

### ZKP
- `POST /api/zkp/generate-inputs` - Generate circuit inputs
- `POST /api/zkp/submit-proof` - Submit proof
- `POST /api/zkp/verify-onchain` - Verify via on-chain contract
- `GET /api/zkp/verifier-info/{chain}` - Get verifier contract info

### Relayer
- `POST /api/relayer/prepare-tx` - Prepare relayer transaction
- `GET /api/relayer/stats/{chain}` - Get relayer stats

### Cross-Chain
- `POST /api/split/prepare` - Create split plan
- `GET /api/split/{split_id}` - Get split status

### Messaging
- `POST /api/messaging/send` - Send encrypted message
- `GET /api/messaging/inbox/{address}` - Get inbox

### Multisig
- `POST /api/multisig/create` - Create multisig
- `POST /api/multisig/propose` - Create proposal
- `POST /api/multisig/sign` - Sign proposal

## KEY FILES
- `/app/frontend/src/App.js` - React frontend
- `/app/backend/server.py` - FastAPI backend
- `/app/contracts/UPLVerifier.sol` - ZKP verifier contract
- `/app/circuits/` - Circom ZKP circuits
- `/app/circuits/build_circuits.sh` - Build script

## TESTING
- Backend: 27/27 tests passed
- Frontend: All features verified
- Report: `/app/test_reports/iteration_5.json`
