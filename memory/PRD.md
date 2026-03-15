# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 15, 2026

## ARCHITECTURE — 3 VM TYPES

| VM | Language | Chains | Status |
|----|----------|--------|--------|
| **EVM** | Solidity | Base, Arbitrum, Polygon, Optimism, BNB, Avalanche, Hyperliquid | ✅ 7 chains LIVE |
| **Solana** | Rust/Anchor | Solana Mainnet | ⏳ Program written, needs local deployment |
| **Sui** | Move | Sui Mainnet | ⏳ Package written, needs local deployment |

## EVM CONTRACT ADDRESSES (same on all 7 chains)
- **PrivacyRelayer**: `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c`
- **StealthRegistry**: `0xf2E7A6734E58774A8417c176AaE3898667699Ff4`

## SOLANA PROGRAM
- **Location**: `/app/contracts/solana/privacy_layer/src/lib.rs`
- **Status**: Written, requires Anchor CLI to deploy
- **Deployment Guide**: `/app/docs/SOLANA_DEPLOYMENT_GUIDE.md`

## SUI PACKAGE
- **Location**: `/app/contracts/sui/privacy_layer/sources/`
- **Status**: Written, requires Sui CLI to deploy
- **Funded Address**: `0xfde77f3867fd0ab7c76fcebc4f0190460d80dc9d1da016bda033e675cb99ff35` (~3.16 SUI)
- **Deployment Guide**: `/app/docs/SUI_DEPLOYMENT_GUIDE.md`

## KEY FILES
- `/app/frontend/src/App.js` — Multi-VM frontend (EVM live, Solana/Sui ready)
- `/app/backend/server.py` — FastAPI backend with 7-chain config
- `/app/contracts/solana/privacy_layer/src/lib.rs` — Anchor program (ready to deploy)
- `/app/contracts/sui/privacy_layer/sources/` — Move modules (ready to deploy)
- `/app/docs/ZKP_IMPLEMENTATION_GUIDE.md` — Zero-Knowledge Proof integration guide

## COMPLETED WORK

### Session - March 15, 2026
- ✅ Fixed frontend to accurately show Solana/Sui as "Coming Soon" (not misleading "Live")
- ✅ Created comprehensive ZKP Implementation Guide (`/app/docs/ZKP_IMPLEMENTATION_GUIDE.md`)
- ✅ Created Solana Deployment Guide (`/app/docs/SOLANA_DEPLOYMENT_GUIDE.md`)
- ✅ Created Sui Deployment Guide (`/app/docs/SUI_DEPLOYMENT_GUIDE.md`)
- ✅ Updated UI stats to show "7 Chains Live" accurately

### Previous Sessions
- ✅ Deployed EVM contracts to 7 mainnet chains
- ✅ Wrote Solana Anchor program
- ✅ Wrote Sui Move package
- ✅ Multi-VM frontend with wallet adapters for MetaMask, Phantom, Sui Wallet

## ENVIRONMENT LIMITATION
The Emergent preview environment runs on `aarch64` (ARM64) architecture. Neither Solana CLI/Anchor nor Sui CLI have official ARM64 binaries, and compilation from source times out. **Deployment of Solana/Sui contracts must be done locally on an x86_64 machine or macOS.**

## BACKLOG

### P0 - High Priority
- [ ] Deploy Solana Anchor program (requires local machine with Solana CLI)
- [ ] Deploy Sui Move package (requires local machine with Sui CLI)
- [ ] Update frontend with deployed program/package IDs

### P1 - Medium Priority
- [ ] Deploy to Rootstock (RSK) for Bitcoin compatibility (EVM, needs RBTC)
- [ ] Implement ZKP circuits (Circom) per guide
- [ ] UniswapWrapper contract deployment

### P2 - Lower Priority
- [ ] Cross-chain balance aggregator dashboard
- [ ] Generate fresh deployer wallet (current seed is documented/compromised)
- [ ] Add more EVM chains (Ethereum mainnet, zkSync, etc.)

## SECURITY NOTES
⚠️ The deployer wallet seed phrase (`inside post tool solar phone...`) is in documentation and git history. Generate a new wallet before any public launch.

## FRONTEND WALLET SUPPORT
- **EVM**: MetaMask (window.ethereum + ethers.js)
- **Solana**: Phantom (window.phantom.solana + @solana/web3.js)  
- **Sui**: Sui Wallet (window.suiWallet + JSON-RPC)
