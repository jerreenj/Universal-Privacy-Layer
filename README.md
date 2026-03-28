<div align="center">

# Universal Privacy Layer

**Privacy infrastructure for on-chain finance.**

[![Live](https://img.shields.io/badge/live-privacycloak.in-00FF94?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMEZGOTQiIHN0cm9rZS13aWR0aD0iMiI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48L3N2Zz4=)](https://privacycloak.in)
[![Chains](https://img.shields.io/badge/9_networks-supported-111111?style=flat-square)](https://privacycloak.in)
[![License](https://img.shields.io/badge/license-proprietary-111111?style=flat-square)](https://privacycloak.in)

Trade, swap, send, and bet — without your wallet being traced.

</div>

---

## The Problem

Every on-chain action is permanently public. Swap on Uniswap, open a perp on Hyperliquid, bet on Polymarket — your wallet, amount, and timing are visible forever. Wallets get profiled, front-run, and tracked across protocols.

## The Solution

UPL routes transactions through **stealth addresses** and **zero-knowledge proofs**. Your origin wallet is mathematically unlinkable from any destination.

---

## Networks

| Network | Type | Private Send | Private Swap | Private DeFi |
|---------|------|:---:|:---:|:---:|
| Base | EVM L2 | ✓ | ✓ | Uniswap V3 |
| Arbitrum | EVM L2 | ✓ | ✓ | Uniswap V3, Hyperliquid |
| Polygon | EVM L1 | ✓ | ✓ | Uniswap V3, Polymarket |
| Optimism | EVM L2 | ✓ | ✓ | Uniswap V3 |
| BNB Chain | EVM L1 | ✓ | ✓ | — |
| Avalanche | EVM L1 | ✓ | ✓ | — |
| Hyperliquid | L1 | ✓ | — | 229 Perp Markets |
| Solana | SVM | ✓ | — | — |
| Sui | MoveVM | ✓ | — | — |

---

## Core Stack

- **Stealth Addresses** — One-time addresses per transaction. Sender and receiver are unlinkable on-chain.
- **Privacy Relayer** — Smart contract submits transactions on your behalf. Your wallet never appears as origin.
- **Zero-Knowledge Proofs** — Groth16 proofs for ownership, range constraints, and set membership without revealing data.
- **Cross-Chain Split** — Fragment a single transaction across multiple chains to eliminate amount fingerprinting.
- **E2E Encrypted Messaging** — ECDH + AES-256-GCM. Server sees only ciphertext.

---

## Private DeFi

**Uniswap V3** — Swaps routed through stealth proxy. Output lands in a fresh stealth address.

**Hyperliquid** — Open perps with margin routed through a stealth proxy. 229 markets, up to 50x leverage.

**Polymarket** — Prediction bets via stealth USDC proxy. Your wallet never touches the CLOB.

---

## Architecture

```
backend/         FastAPI — 80+ endpoints, session auth, privacy routing
contracts/       Solidity — Relayer, StealthRegistry, ZKP Verifier, Uniswap Wrapper
frontend/        React 18 — Modular dashboard, 25+ components
Dockerfile       Single-service production build
```

---

## Security

| Layer | Detail |
|-------|--------|
| Auth | Session token after passphrase. Required on every endpoint. |
| Rate Limit | 5 auth attempts / min per IP |
| Keys | Generated once, returned once, never stored |
| Encryption | secp256k1 ECDH + AES-256-GCM for messaging |
| CORS | Locked to production domain |
| API Docs | `/docs` and `/openapi.json` disabled in production |
| Headers | XSS, clickjacking, referrer policy enforced |

---

## Deploy

```bash
docker build -t upl .
docker run -d --name upl --restart always \
  -p 8001:8001 \
  -e MONGO_URL=mongodb://localhost:27017 \
  -e DB_NAME=privacycloak \
  -e ACCESS_CODE=<your_code> \
  -e PAYOUT_WALLET=<your_wallet> \
  -e CORS_ORIGINS=https://yourdomain.com \
  upl
```

---

## Payments

Crypto-only. ETH, USDC, USDT, DAI, MATIC, BNB, AVAX accepted across all supported chains. No card required, no KYC, no intermediary.

---

<div align="center">

**[privacycloak.in](https://privacycloak.in)**

All rights reserved.

</div>
