# Universal Privacy Layer (UPL) - Product Requirements Document

**Last Updated:** Jan 2026

## Original Problem Statement
Build Universal Privacy Layer (UPL) - "The HTTPS of Web3" - a universal privacy wrapper for every major blockchain. Real production system with real money transactions, NOT mock data.

## Core Value Proposition
Deliver **unreadability**, **unidentifiability**, and **untraceability** for all blockchain transactions.

---

## Target User Personas
- Crypto whales wanting privacy
- DeFi traders
- Institutional funds
- NFT collectors
- DAOs
- Privacy-conscious retail users

---

## The 10 Privacy Pillars (Core Features)
1. ✅ Hidden Wallet Creation & Dual Seed Phrase
2. ✅ Hidden Wallet Balance
3. ✅ Private Send & Receive
4. ✅ Private Transaction Hash Delivery
5. ✅ Stealth Address Generation
6. ⬜ Private Swaps (DEX integration)
7. ⬜ NFT Transaction Privacy
8. ⬜ Smart Contract Interaction Privacy
9. ⬜ Token Approval Privacy
10. ⬜ Cross-Chain Transfer Privacy

---

## What's Been Implemented (Jan 2026)

### Backend (FastAPI + MongoDB)
- ✅ Health check endpoint
- ✅ Chain configuration API (Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia)
- ✅ Stealth address generation using real ECDH cryptography
- ✅ Dual-key wallet creation with seed phrases (eth-account)
- ✅ Encrypted receipt system (AES-256-GCM via pycryptodome)
- ✅ Receipt decryption with one-time codes
- ✅ Transaction recording and history
- ✅ Balance aggregation (main + stealth addresses)
- ✅ Stealth address scanning

### Frontend (React + ethers.js)
- ✅ Cyber-noir dark theme (Unbounded, Rajdhani, JetBrains Mono fonts)
- ✅ Landing page with Connect Wallet CTA
- ✅ MetaMask wallet integration
- ✅ Chain selector (3 testnets)
- ✅ Balance display with hidden/visible toggle
- ✅ Stealth address generator
- ✅ Private send transaction form
- ✅ Transaction history display
- ✅ Privacy pillars info section
- ✅ Toast notifications (sonner)
- ✅ All data-testid attributes

### Cryptography (REAL, NOT MOCKED)
- ✅ ECDH key exchange for stealth addresses
- ✅ AES-256-GCM encryption for receipts
- ✅ PBKDF2 key derivation
- ✅ View tags for efficient scanning

---

## Technical Architecture

### Supported Chains (Testnets)
| Chain | Chain ID | RPC | Explorer |
|-------|----------|-----|----------|
| Ethereum Sepolia | 11155111 | rpc.sepolia.org | sepolia.etherscan.io |
| Arbitrum Sepolia | 421614 | sepolia-rollup.arbitrum.io/rpc | sepolia.arbiscan.io |
| Base Sepolia | 84532 | sepolia.base.org | sepolia.basescan.org |

### Tech Stack
- **Backend:** FastAPI, MongoDB, web3.py, eth-account, pycryptodome
- **Frontend:** React, ethers.js v6, Tailwind CSS, Lucide icons
- **Database:** MongoDB (wallets, stealth_addresses, receipts, transactions)

---

## Prioritized Backlog

### P0 (Done)
- ✅ Core stealth address system
- ✅ Wallet integration
- ✅ Private send flow
- ✅ Encrypted receipts

### P1 (Next Phase)
- ⬜ Uniswap V3 integration for private swaps
- ⬜ OpenSea integration for NFT privacy
- ⬜ Smart contract interaction wrapping
- ⬜ Mainnet deployment scripts

### P2 (Future)
- ⬜ Multisig privacy module
- ⬜ Cross-chain bridge privacy
- ⬜ Institutional API
- ⬜ Compliance module

---

## Deployment Readiness

### Testnet → Mainnet Migration
Code is 100% identical. Only config changes needed:
1. Update RPC URLs in CHAIN_CONFIG
2. Change chain IDs
3. Redeploy contracts (same Solidity code)

### Estimated Mainnet Costs
- Arbitrum/Base: ~$10-15 total
- Ethereum L1: ~$100-300

---

## ZKP Implementation Guide (For User)

To add production ZKP circuits:

1. **Install Circom:** `npm install -g circom snarkjs`
2. **Create circuit:** Define proof logic in `.circom` file
3. **Trusted setup:** Run `snarkjs powersoftau` ceremony
4. **Generate verifier:** `snarkjs generateverifier`
5. **Deploy verifier contract:** Solidity contract on-chain
6. **Integrate:** Call verifier from relayer contracts

Resources:
- https://docs.circom.io/
- https://github.com/iden3/snarkjs

---

## Next Tasks
1. User to fund deployer wallet with testnet ETH
2. Deploy Smart Relayer contracts to testnets
3. Add Uniswap integration for private swaps
4. Implement NFT privacy module
5. Add ZKP circuits (user-guided)
