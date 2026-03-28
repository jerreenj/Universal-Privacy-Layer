# PrivacyCloak — Universal Privacy Layer

## Problem Statement
Production-ready privacy layer for crypto transactions. DeFi + privacy-preserving routing. Stealth Payments, Encrypted Messaging, multi-chain support.

## Architecture
- Frontend: React 18 + Tailwind + ethers.js
- Backend: FastAPI + MongoDB
- Crypto: @noble/secp256k1 v3, EIP-5564
- Hosting: Hostinger VPS (ROTATED-VPS-IP) + Docker + Nginx + Let's Encrypt
- Admin: Retool (connected via SSH tunnel to MongoDB)

## Implemented
- [x] Access Gate + persistent MongoDB sessions (1yr TTL)
- [x] EIP-5564 Stealth Payments (off-chain relay)
- [x] E2E Encrypted Messaging (ECDH + AES-256-GCM)
- [x] Private DeFi (Uniswap V3, Hyperliquid, Polymarket)
- [x] Crypto-only payments (QR, MetaMask, manual)
- [x] Pricing page (Phantom $50, Specter $4,999, Wraith $24,999)
- [x] Deployed to Hostinger VPS with HTTPS + Let's Encrypt
- [x] Wallet Privacy Analyzer — 6 EVM chains, privacy score 0-100 (2026-03-28)
- [x] Encrypted Receipts — AES-256-GCM, one-time code decryption (2026-03-28)
- [x] Privacy Address Book — Encrypted contacts, full CRUD (2026-03-28)
- [x] ZK Commitments — Client-side SHA-256 with blinding factors (2026-03-28)
- [x] Messaging privacy fix — stealth address as sender, never leaks public address (2026-03-28)
- [x] Stealth address auto-rotation — max 3 uses, then new address (2026-03-28)
- [x] Inbox fix — checks real + all stealth addresses (2026-03-28)
- [x] 72-hour message auto-delete via MongoDB TTL (2026-03-28)
- [x] Email collection after payment (2026-03-28)
- [x] Contact email: jerreen@jasprlabs.com on pricing page (2026-03-28)
- [x] Retool admin dashboard — SSH tunnel to MongoDB (2026-03-28)

## Pending (BLOCKED on gas funding)
- [ ] On-chain StealthAddressRegistry.sol deployment
- [ ] Privacy Pools
- [ ] On-chain smart contracts

## Key DB Collections
- `sessions`, `stealth_addresses`, `stealth_meta`, `stealth_rotation`
- `encrypted_messages` (72hr TTL), `receipts`, `payment_transactions`
- `address_book`, `zk_commitments`, `messaging_keys`

## Contact
- jerreen@jasprlabs.com
