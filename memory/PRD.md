# PrivacyCloak — Universal Privacy Layer

## Problem Statement
Build a production-ready "Universal Privacy Layer" for cryptocurrency transactions. Core: DeFi + privacy-preserving routing. Features: Access Gate, EIP-5564 Stealth Payments, Encrypted Messaging, Founder Mode dashboard, multi-chain support (7 EVM + Solana/Sui planned).

## Architecture
- **Frontend**: React + Tailwind + Ethers.js + Web3Modal
- **Backend**: FastAPI + MongoDB
- **Cryptography**: @noble/secp256k1 v3.0.0, EIP-5564 compliant

## Code Structure (Updated Feb 28, 2026)
```
frontend/src/
├── App.js                           # Thin router (~65 lines)
├── lib/session.js                   # Session token mgmt + 401 interceptor
├── lib/messageCrypto.js             # ECDH + AES-GCM E2E encryption
├── config/chains.js                 # Chain registry, API constants
├── context/WalletContext.jsx         # Wallet state provider
├── components/
│   ├── auth/AccessGate.jsx          # Access code gate
│   ├── layout/
│   │   ├── Navbar.jsx               # Top navigation
│   │   ├── Landing.jsx              # Pre-wallet landing page
│   │   └── Dashboard.jsx            # Main navigation hub
│   ├── common/
│   │   ├── BackButton.jsx
│   │   └── CopyButton.jsx
│   ├── ui/pricing.jsx               # Interactive pricing section component
│   └── features/                    # 21 feature components
│       ├── StealthMeta.jsx
│       ├── StealthSend.jsx
│       ├── StealthReceive.jsx
│       ├── EncryptedMessaging.jsx
│       └── ... (17 more)
├── pages/
│   ├── FounderMode.jsx
│   ├── DeveloperAPI.jsx
│   └── Pricing.jsx                  # Pricing page (3 plans)
backend/
├── server.py                        # All API routes
```

## What's Implemented
- [x] Access Gate with code authentication (code: ROTATED-ACCESS-CODE)
- [x] Session management with 72h TTL + 401 interceptor auto-logout
- [x] Founder Mode hidden dashboard at /founder
- [x] EIP-5564 Stealth Payments (Phase 1: off-chain via MongoDB)
  - Meta-address generation
  - Stealth sending
  - Stealth scanning/receiving
- [x] Encrypted P2P Messaging — **True E2E** (ECDH secp256k1 + AES-256-GCM)
- [x] Private DeFi integrations (Uniswap V3, Hyperliquid, Polymarket)
- [x] Cross-Chain Split payments
- [x] ZKP Proof system
- [x] On-Chain Relayer
- [x] NFT/Token/Contract privacy proxies
- [x] Multisig privacy wallets
- [x] Developer API with key management
- [x] 7 EVM chains live
- [x] App.js monolith refactored (25+ components)
- [x] Railway deployment (Dockerfile + railway.toml)
- [x] **Pricing page** at /pricing — 3 plans (Phantom/Specter/Wraith) with interactive starfield, Monthly/Annual toggle
- [x] **All mock/demo data removed** — Polymarket returns real CLOB API data or proper 503 error
- [x] **CSS variables migrated** to HSL format for full shadcn compatibility

## Pending / Backlog
### P1
- [ ] Migrate stealth announcements on-chain (BLOCKED: deployer wallet unfunded)

### P2
- [ ] Fixed Denomination Privacy Pools (Tornado Cash model)
- [ ] ZK Proofs with Commitments (arbitrary amounts)

### P3
- [ ] Wallet Privacy Analyzer
- [ ] Private Encrypted Receipts
- [ ] Privacy-First Address Book
- [ ] Solana chain integration
- [ ] Sui chain integration

## Key Credentials
- Access Code: `ROTATED-ACCESS-CODE`
- Founder Token: `ae77cc286ceac8639d06f4dcda7eb5e341e5f92b4755419df1fa2e23e5b09c42`
- Deployer Wallet: `0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4` (unfunded)

## MOCKED
- Smart contracts NOT deployed — stealth announcements relay via MongoDB backend
