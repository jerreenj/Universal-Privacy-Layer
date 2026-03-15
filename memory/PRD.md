# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 2026

## ARCHITECTURE — 3 VM TYPES

| VM | Language | Chains | Status |
|----|----------|--------|--------|
| **EVM** | Solidity | Base, Arbitrum, Polygon, Optimism, BNB, Avalanche, Hyperliquid | ✅ 7 chains live |
| **Solana** | Rust/Anchor | Solana Mainnet | ✅ Program written, needs `anchor deploy` |
| **Sui** | Move | Sui Mainnet | ✅ Package written, needs `sui client publish` + SUI funding |

## EVM CONTRACT ADDRESSES (same on all 7 chains)
- **PrivacyRelayer**: `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c`
- **StealthRegistry**: `0xf2E7A6734E58774A8417c176AaE3898667699Ff4`

## SOLANA DEPLOYER ADDRESS
- `GKnJ5sMFTVuvzWKoUHDaGh2zRxNRRFGFV7QCg1uZXUY9` (derive from mnemonic via ed25519)
- Program: `/app/contracts/solana/privacy_layer/src/lib.rs`
- Deploy: `anchor build && anchor deploy --provider.cluster mainnet`

## SUI DEPLOYER ADDRESS
- `0xfde77f3867fd0ab7c76fcebc4f0190460d80dc9d1da016bda033e675cb99ff35`
- Package: `/app/contracts/sui/privacy_layer/sources/`
- Deploy: `sui client publish --gas-budget 100000000`
- Needs: 0.5 SUI

## FRONTEND WALLET SUPPORT
- **EVM**: MetaMask (window.ethereum + ethers.js)
- **Solana**: Phantom (window.phantom.solana + @solana/web3.js)
- **Sui**: Sui Wallet (window.suiWallet + JSON-RPC)

## LIVE CHAINS (9 total)
Base, Arbitrum, Polygon, Optimism, BNB Chain, Avalanche, Hyperliquid, Solana, Sui

## KEY FILES
- `/app/frontend/src/App.js` — Multi-VM frontend (EVM + Solana + Sui)
- `/app/backend/server.py` — FastAPI backend with 7-chain config
- `/app/contracts/solana/privacy_layer/src/lib.rs` — Anchor program
- `/app/contracts/sui/privacy_layer/sources/` — Move modules
- `/app/contracts/deploy_*.py` — EVM deployment scripts

## BACKLOG
- P0: Deploy Anchor program to Solana mainnet (needs SOL + Anchor CLI)
- P0: Deploy Move package to Sui mainnet (needs SUI funding to `0xfde77...`)
- P1: UniswapWrapper contract (Uniswap V3 integration)
- P1: ZKP circuits (Circom + snarkjs)
- P2: Bitcoin/RSK deployment (EVM-compatible, minimal RBTC needed)
- P3: Cross-chain balance aggregator dashboard
