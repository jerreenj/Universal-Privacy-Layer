# PrivacyCloak — Universal Privacy Layer

## Problem Statement
Production-ready privacy layer for crypto transactions. DeFi + privacy-preserving routing. Stealth Payments, Encrypted Messaging, multi-chain support.

## Architecture
- Frontend: React 18 + Tailwind + ethers.js
- Backend: FastAPI + managed database
- Crypto: @noble/secp256k1 v3, EIP-5564
- Hosting: Azure Container Apps (managed TLS)
- Admin: internal dashboard (private database access)

## Implemented
- [x] Access Gate + persistent database sessions (1yr TTL)
- [x] EIP-5564 Stealth Payments (off-chain relay)
- [x] E2E Encrypted Messaging (ECDH + AES-256-GCM)
- [x] Private DeFi (Uniswap V3, Hyperliquid, Polymarket)
- [x] Deployed to Azure Container Apps with managed TLS
- [x] Wallet Privacy Analyzer — 6 EVM chains, privacy score 0-100 (2026-03-28)
- [x] Encrypted Receipts — AES-256-GCM, one-time code decryption (2026-03-28)
- [x] Privacy Address Book — Encrypted contacts, full CRUD (2026-03-28)
- [x] ZK Commitments — Client-side SHA-256 with blinding factors (2026-03-28)
- [x] Messaging privacy fix — stealth address as sender, never leaks public address (2026-03-28)
- [x] Stealth address auto-rotation — max 3 uses, then new address (2026-03-28)
- [x] Inbox fix — checks real + all stealth addresses (2026-03-28)
- [x] 72-hour message auto-delete via database TTL (2026-03-28)
- [x] Internal admin dashboard — private database access (2026-03-28)

## Pending (BLOCKED on gas funding)
- [ ] On-chain StealthAddressRegistry.sol deployment
- [ ] Privacy Pools
- [ ] On-chain smart contracts

## Key DB Collections
- `sessions`, `stealth_addresses`, `stealth_meta`, `stealth_rotation`
- `encrypted_messages` (72hr TTL), `receipts`, `payment_transactions`
- `address_book`, `zk_commitments`, `messaging_keys`

## Contact
- jerreen@privacycloak.in


