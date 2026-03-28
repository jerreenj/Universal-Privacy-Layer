# PrivacyCloak — Universal Privacy Layer

## Problem Statement
Production-ready privacy layer for crypto transactions. DeFi + privacy-preserving routing. Stealth Payments, Encrypted Messaging, multi-chain support.

## Architecture
- Frontend: React 18 + Tailwind + ethers.js
- Backend: FastAPI + MongoDB
- Crypto: @noble/secp256k1 v3, EIP-5564
- Hosting: Hostinger VPS (ROTATED-VPS-IP) + Docker + Nginx + Let's Encrypt

## Implemented
- [x] Access Gate + persistent MongoDB sessions (1yr TTL)
- [x] EIP-5564 Stealth Payments (off-chain relay)
- [x] E2E Encrypted Messaging (ECDH + AES-256-GCM)
- [x] Private DeFi (Uniswap V3, Hyperliquid, Polymarket)
- [x] Crypto-only payments (QR, MetaMask, manual)
- [x] Pricing page (Phantom $50 trial, Specter $4,999, Wraith $24,999)
- [x] Founder Mode removed
- [x] All mock data removed
- [x] Deployed to Hostinger VPS with HTTPS
- [x] **Wallet Privacy Analyzer** — Scans any wallet across 6 EVM chains via public RPCs, scores privacy posture (0-100, A+ to F grade), identifies risks & recommendations. Zero gas, permanently free. (2026-03-28)
- [x] **Encrypted Receipts** — AES-256-GCM encrypted proof-of-payment for stealth sends. One-time code decryption. Browser-generated, stored in DB. (2026-03-28)
- [x] **Privacy Address Book** — Encrypted contact storage by stealth meta-address. Full CRUD. Notes encrypted client-side before storage. (2026-03-28)
- [x] **ZK Commitments** — Client-side SHA-256 zero-knowledge amount commitments with cryptographic blinding factors. Commit, verify, and track history. All math runs in user's browser. (2026-03-28)

## Pending
- [ ] On-chain stealth migration (needs deployer wallet funding)
- [ ] Privacy Pools (needs deployer wallet funding)
- [ ] On-Chain Smart Contract deployment (StealthAddressRegistry.sol, Privacy Pools) — BLOCKED on gas

## Key DB Collections
- `sessions`: {token, expires_at (TTL indexed)}
- `stealth_addresses`: {off-chain stealth announcements}
- `encrypted_messages`: {P2P messages, e2e bool}
- `payment_transactions`: {crypto payments from pricing page}
- `address_book`: {owner_address, label, stealth_meta_address, public_address, notes_encrypted}
- `zk_commitments`: {commitment_id, owner_address, commitment_hash, amount_range, revealed}
- `receipts`: {receipt_id, encrypted_data, one_time_code_hash}

## Key API Endpoints (New)
- `GET /api/analyzer/scan/{address}` — Privacy score across 6 chains
- `POST /api/addressbook/add` — Add encrypted contact
- `GET /api/addressbook/{owner}` — List contacts
- `DELETE /api/addressbook/{entry_id}` — Delete contact
- `POST /api/zk-commitments/create` — Create commitment hash
- `GET /api/zk-commitments/{owner}` — List commitments
- `POST /api/zk-commitments/verify` — Verify with amount + blinding factor
- `POST /api/receipt/create` — Create encrypted receipt
- `POST /api/receipt/decrypt` — Decrypt with one-time code
