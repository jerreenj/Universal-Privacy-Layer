# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 15, 2026

## PRODUCT VISION
Universal Privacy Layer provides private transactions across multiple blockchain networks through a single interface. Users can send, receive, and swap tokens privately using stealth addresses and privacy-wrapped transactions.

## ARCHITECTURE — 3 VM TYPES

| VM | Language | Chains | Status |
|----|----------|--------|--------|
| **EVM** | Solidity | Base, Arbitrum, Polygon, Optimism, BNB, Avalanche, Hyperliquid | ✅ 7 chains LIVE |
| **Solana** | Rust/Anchor | Solana Mainnet | ⏳ Program written, needs deployment |
| **Sui** | Move | Sui Mainnet | ⏳ Package written, needs deployment |

## EVM CONTRACT ADDRESSES (same on all 7 chains)
- **PrivacyRelayer**: `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c`
- **StealthRegistry**: `0xf2E7A6734E58774A8417c176AaE3898667699Ff4`

## IMPLEMENTED FEATURES

### ✅ P0 - Core Features (COMPLETE)
1. **Hidden Wallet Balance** - Aggregated balance across ALL stealth addresses on all 7 chains
2. **Dual Seed Phrase System** - Separate Main Seed (funds) + Privacy Seed (privacy envelope)
3. **Transaction History** - Complete history with direction (in/out) indicators
4. **Private Receive** - Stealth address generation for untraceable receiving
5. **Private Send** - Send to stealth addresses with transaction recording
6. **Private Swap** - Privacy-wrapped swaps with 0.05% fee

### ✅ P1 - Advanced Privacy (COMPLETE)
1. **NFT Privacy Proxy** - Anonymous proxy for NFT buy/sell/transfer/bid operations
2. **Token Approval Privacy** - Disposable addresses for token approvals (prevents fingerprinting)
3. **Smart Contract Privacy** - Anonymous execution proxy for contract interactions
4. **Chain Status Dashboard** - Real-time status of all supported chains

## API ENDPOINTS

### Core
- `GET /api/health` - Health check
- `GET /api/stats` - Platform statistics
- `GET /api/chains` - Chain configurations

### Balance & History
- `GET /api/balance/hidden/{address}` - Aggregated balance across all chains & stealth addresses
- `GET /api/transactions/history/{address}` - Complete transaction history

### Wallet Management
- `POST /api/wallet/create` - Create dual seed wallet
- `POST /api/wallet/register-privacy` - Register privacy keys for existing wallet
- `GET /api/wallet/privacy/{address}` - Get privacy wallet info

### Stealth Addresses
- `POST /api/stealth/generate` - Generate stealth address
- `GET /api/stealth/scan/{address}` - Scan for stealth addresses

### Privacy Proxies
- `POST /api/nft/proxy` - Create NFT privacy proxy
- `POST /api/approval/create-disposable` - Create disposable approval address
- `POST /api/contract/proxy` - Create anonymous contract proxy

### Transactions
- `POST /api/transactions/record` - Record private transaction
- `POST /api/swap/record` - Record private swap

## KEY FILES
- `/app/frontend/src/App.js` - Main React app with all features
- `/app/backend/server.py` - FastAPI backend with all endpoints
- `/app/contracts/solana/` - Solana Anchor program (ready to deploy)
- `/app/contracts/sui/` - Sui Move package (ready to deploy)
- `/app/docs/ZKP_IMPLEMENTATION_GUIDE.md` - ZKP integration guide

## TESTING STATUS
- Backend: 100% (19/19 tests passed)
- Frontend: 100% (all features verified)
- Test report: `/app/test_reports/iteration_4.json`

## BACKLOG

### P2 - Coming Soon
- [ ] Deploy Solana program (requires local CLI)
- [ ] Deploy Sui package (requires local CLI)
- [ ] Deploy to Rootstock (RSK) for Bitcoin compatibility
- [ ] Implement ZKP circuits (Circom)
- [ ] Cross-chain balance aggregator with USD values

### P3 - Future
- [ ] Multisig privacy module
- [ ] Compliance module for institutions
- [ ] Developer API for third-party integration
- [ ] Mobile wallet support

## SECURITY NOTES
⚠️ The deployer wallet seed phrase is in documentation. Generate a new wallet before public launch.
