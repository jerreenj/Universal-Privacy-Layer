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

## Pending
- [ ] On-chain stealth migration (needs deployer wallet funding)
- [ ] Privacy Pools / ZK Commitments
- [ ] Wallet Privacy Analyzer
