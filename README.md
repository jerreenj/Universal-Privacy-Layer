<div align="center">

<br>

<img src="https://img.shields.io/badge/%E2%96%88%E2%96%88%E2%96%88-UPL-00FF94?style=for-the-badge&labelColor=000000" alt="UPL" />

<br><br>

# Universal Privacy Layer

### The invisible backbone for On-chain finance.

<br>

[![Live](https://img.shields.io/badge/LIVE-privacycloak.in-00FF94?style=for-the-badge&labelColor=0a0a0a)](https://privacycloak.in)
&nbsp;&nbsp;
[![Chains](https://img.shields.io/badge/NETWORKS-9-00F0FF?style=for-the-badge&labelColor=0a0a0a)](#-supported-networks)
&nbsp;&nbsp;
[![Status](https://img.shields.io/badge/STATUS-PRIVATE%20BETA-FF3B30?style=for-the-badge&labelColor=0a0a0a)](#)
&nbsp;&nbsp;
[![Solidity](https://img.shields.io/badge/SOLIDITY-5_CONTRACTS-9945FF?style=for-the-badge&labelColor=0a0a0a)](#-smart-contracts)
&nbsp;&nbsp;
[![API](https://img.shields.io/badge/API-80%2B_ENDPOINTS-F7931A?style=for-the-badge&labelColor=0a0a0a)](#-architecture)

<br>

*Trade. Swap. Send. Bet.*
*Without your wallet being traced. Ever.*

<br>

---

</div>

<br>

## The Problem

Every on-chain transaction is a **permanent public record.**

When you swap on Uniswap, open a leveraged position on Hyperliquid, or place a bet on Polymarket — your wallet address, the exact amount, the timestamp, and every counterparty are visible to anyone, forever. Block explorers index it. MEV bots front-run it. Analytics firms profile it. Your entire financial identity is an open book.

**Wallets get:**
- Profiled across protocols (your Uniswap trades linked to your Polymarket bets)
- Front-run by MEV bots watching your pending transactions
- Cross-chain tracked by analytics firms building shadow profiles
- Targeted with phishing after large transactions become public
- Flagged and blacklisted based on association with other wallets
- Exploited through sandwich attacks on high-value pending swaps

> *"If you think deleting your transaction history is possible, you don't understand blockchains. Every trace is permanent. The only solution is to never leave one."*

<br>

## The Solution

UPL makes your wallet **mathematically unlinkable** from any transaction.

Every operation — whether it's a token swap, a perp trade, a prediction bet, or a simple transfer — is routed through a freshly generated **stealth address** backed by **zero-knowledge cryptography**. The origin wallet and the destination exist in two completely separate on-chain realities. No link. No trace. No fingerprint.

```
  Your Wallet                                           The Blockchain
       │                                                       │
       │   ┌──────────────────────────────────────────┐        │
       │   │  1. Stealth Address Generation           │        │
       │   │  2. ZK Proof Construction                │        │
       │   │  3. Cross-Chain Fragmentation            │        │
       │   │  4. Relayer Submission                   │        │
       │   └──────────────────────────────────────────┘        │
       │                                                       │
       └──────── mathematically unlinkable ───────────────────>│
                                                               │
                 No link.  No trace.  No fingerprint.          │
                                                               │
                 Even UPL cannot reconstruct the path.         │
```

<br>

---

<br>

## Supported Networks

<table>
<tr>
<th align="left">Network</th>
<th align="left">Type</th>
<th align="left">Native Token</th>
<th align="center">Private Send</th>
<th align="center">Private Swap</th>
<th align="left">Private DeFi</th>
</tr>
<tr>
<td><b>Base</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3</td>
</tr>
<tr>
<td><b>Arbitrum</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3 &middot; Hyperliquid</td>
</tr>
<tr>
<td><b>Polygon</b></td><td>EVM L1</td><td>POL</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3 &middot; Polymarket</td>
</tr>
<tr>
<td><b>Optimism</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3</td>
</tr>
<tr>
<td><b>BNB Chain</b></td><td>EVM L1</td><td>BNB</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Avalanche</b></td><td>EVM L1</td><td>AVAX</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Hyperliquid</b></td><td>L1 Perps</td><td>HYPE</td>
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>229 Perpetual Markets &middot; 50x Leverage</td>
</tr>
<tr>
<td><b>Solana</b></td><td>SVM</td><td>SOL</td>
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Sui</b></td><td>MoveVM</td><td>SUI</td>
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>&mdash;</td>
</tr>
</table>

<br>

---

<br>

## Privacy Primitives

<table>
<tr>
<td width="50%">

### Stealth Addresses
A unique one-time address is generated for **every transaction** using an EIP-5564 compliant ephemeral keypair derived from `secp256k1` elliptic curve cryptography. The recipient is the only entity who can mathematically detect and claim the funds. There is zero on-chain link between sender and receiver.

**Standard:** EIP-5564 &middot; **Curve:** secp256k1 &middot; **Key Exchange:** ECDH

</td>
<td width="50%">

### Zero-Knowledge Proofs
Groth16 proofs (constructed with Circom circuits) enable you to prove ownership of funds, satisfy range constraints, or demonstrate set membership — **without revealing any underlying data.** The blockchain verifies the proof. It never sees the secret.

**Proof System:** Groth16 &middot; **Circuit Language:** Circom &middot; **Verification:** On-chain Solidity

</td>
</tr>
<tr>
<td>

### Privacy Relayer
A dedicated smart contract relayer submits transactions on behalf of the user. Your wallet address **never appears as the transaction origin.** Gas is abstracted. The relayer is the only address visible on-chain.

**Gas:** Abstracted &middot; **Visibility:** Only relayer address on-chain &middot; **User Wallet:** Hidden

</td>
<td>

### Cross-Chain Fragmentation
A single transaction is broken into multiple fragments and dispatched across **different chains simultaneously.** Amount correlation analysis — one of the most effective de-anonymization techniques — becomes computationally infeasible.

**Chains:** Up to 9 simultaneous &middot; **Analysis Resistance:** Amount, timing, chain correlation

</td>
</tr>
</table>

<br>

---

<br>

## Private DeFi Integrations

<table>
<tr>
<td width="33%">

### Uniswap V3

Token swaps routed through a stealth proxy contract. Quotes fetched directly from the on-chain Quoter contract, with DeFiLlama as a price oracle fallback. Swap output lands in a **freshly generated stealth address.**

Your wallet never touches the DEX.

**Chains:** Base, Arbitrum, Polygon, Optimism

</td>
<td width="33%">

### Hyperliquid

Open perpetual futures with margin routed through a fresh stealth proxy on every trade. **229 available markets** with up to **50x leverage.** Your wallet is never deposited directly.

Every position is isolated behind a unique ephemeral address.

**Markets:** 229 &middot; **Max Leverage:** 50x

</td>
<td width="33%">

### Polymarket

Prediction market bets via stealth USDC proxy. Your wallet **never interacts with the CLOB.** Bet, win, and withdraw — all through one-time stealth addresses.

Cannot be linked back to your identity.

**Chain:** Polygon &middot; **Token:** USDC

</td>
</tr>
</table>

<br>

---

<br>

## Additional Capabilities

| Feature | Description |
|:--------|:------------|
| **End-to-End Encrypted Messaging** | `secp256k1` ECDH key agreement + `AES-256-GCM` symmetric encryption. Server processes only ciphertext. Even UPL cannot read your messages. Messages are deleted after 30 days. |
| **Hidden Balance Aggregation** | Unified view of all funds held across your stealth addresses, broken down by chain and token. No external observer can reconstruct the full picture. |
| **NFT Privacy Transfer** | Move NFTs (ERC-721, ERC-1155) between wallets without creating an on-chain link between sender and receiver. Metadata is never exposed. |
| **Token Approval Privacy** | Manage ERC-20 approvals through stealth proxies to prevent on-chain approval fingerprinting. Revoke and re-approve without trace. |
| **Multisig Privacy Vaults** | Multi-signature wallet flows with hidden participant identities. Signers are never revealed on-chain. Threshold configurable from 2-of-3 to M-of-N. |
| **Contract Interaction Privacy** | Interact with any smart contract through a stealth proxy. Your wallet address is never exposed as the `msg.sender`. |
| **Progressive Web App** | Installable on mobile and desktop with offline caching, service worker support, and native-like experience. |
| **Developer API** | Full programmatic access with API key management. Build privacy features into your own applications. |

<br>

---

<br>

## Architecture

```
Universal-Privacy-Layer/
│
├── backend/                            Python 3.11 · FastAPI · Motor (async MongoDB)
│   ├── server.py                       80+ API endpoints, single-file microservice
│   │   ├── Session Auth                Passphrase → token, rate-limited, MongoDB-persisted
│   │   ├── Stealth Engine              EIP-5564 meta-address generation, announcement relay
│   │   ├── Privacy Router              Cross-chain splits, relayer dispatch, fee calculation
│   │   ├── DeFi Integrations           Uniswap V3, Hyperliquid, Polymarket CLOB
│   │   ├── Encrypted Messaging         True E2E (ECDH + AES-GCM) with legacy fallback
│   │   ├── Crypto Payments             Direct wallet, QR code, MetaMask one-click
│   │   ├── Developer API               Key issuance, rate limiting, usage tracking
│   │   └── Security Middleware         CORS, headers, rate limiting, input sanitization
│   └── requirements.txt
│
├── contracts/                          Solidity ^0.8.19 · EVM Smart Contracts
│   ├── PrivacyRelayer.sol              Gasless transaction relay with fee abstraction
│   ├── StealthAddressRegistry.sol      On-chain stealth announcement registry (EIP-5564)
│   ├── UPLVerifier.sol                 ZK proof verification wrapper with batch support
│   ├── Groth16Verifier.sol             Circom-generated Groth16 proof verifier
│   └── UniswapPrivacyWrapper.sol       Stealth-routed Uniswap V3 swap interactions
│
├── frontend/                           React 18 · Tailwind CSS · ethers.js · Web3Modal
│   └── src/
│       ├── App.js                      Minimal router (60 lines)
│       ├── components/                 25+ modular feature components
│       │   ├── auth/                   Access gate with brute-force protection
│       │   ├── features/               Stealth send/receive, messaging, DeFi, NFT, multisig
│       │   ├── layout/                 Navbar, dashboard hub, animated landing
│       │   ├── common/                 BackButton, CopyButton, shared utilities
│       │   └── ui/                     shadcn/ui primitives, interactive pricing section
│       ├── pages/                      Pricing page with crypto payment flow
│       ├── config/                     Chain registry, RPC endpoints, API constants
│       ├── context/                    Multi-chain wallet state provider (WalletContext)
│       ├── lib/                        messageCrypto.js (ECDH), session.js (token mgmt)
│       └── utils/                      stealth.js — EIP-5564 secp256k1 elliptic curve math
│
└── Dockerfile                          Multi-stage build: Node 20 (frontend) → Python 3.11 (backend)
```

<br>

---

<br>

## System Flow

```
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
         │                       ACCESS GATE                           │
         │              Passphrase → Session Token                     │
         │          Rate-limited · 1-year TTL · MongoDB                │
         │                                                              │
         └────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
         │              STEALTH ADDRESS GENERATOR                      │
         │       EIP-5564 · secp256k1 · ECDH Key Agreement            │
         │       Fresh ephemeral keypair for every transaction         │
         │                                                              │
         └────────────────────────┬─────────────────────────────────────┘
                                  │
            ┌──────────┬──────────┼──────────┬──────────┬───────────┐
            │          │          │          │          │           │
            ▼          ▼          ▼          ▼          ▼           ▼
       ┌─────────┐┌─────────┐┌────────┐┌─────────┐┌─────────┐┌─────────┐
       │ Privacy ││ Uniswap ││ Hyper- ││  Poly-  ││  Cross  ││   E2E   │
       │ Relayer ││ V3 Swap ││ liquid ││ market  ││  Chain  ││  Msg    │
       │         ││ Proxy   ││ Perps  ││  Bets   ││  Split  ││ ECDH   │
       └────┬────┘└────┬────┘└───┬────┘└────┬────┘└────┬────┘└────┬────┘
            │          │         │          │          │          │
            ▼          ▼         ▼          ▼          ▼          ▼
       ┌──────────────────────────────────────────────────────────────┐
       │                                                              │
       │             DESTINATION STEALTH ADDRESS                      │
       │        Mathematically unlinkable from origin                 │
       │        Only the intended recipient can detect & claim        │
       │                                                              │
       └──────────────────────────────────────────────────────────────┘
```

<br>

---

<br>

## Smart Contracts

| Contract | Purpose | Key Mechanism |
|:---------|:--------|:-------------|
| `PrivacyRelayer.sol` | Submits transactions on behalf of users. Wallet never appears as `msg.sender`. | Meta-transaction relay with gas abstraction |
| `StealthAddressRegistry.sol` | On-chain registry where stealth payment announcements are published. | EIP-5564 compliant ephemeral public key announcements |
| `UPLVerifier.sol` | Wrapper for verifying zero-knowledge proofs on-chain. Supports batch verification. | Groth16 proof verification with public input validation |
| `Groth16Verifier.sol` | Auto-generated from Circom circuits. Performs the actual elliptic curve pairing checks. | BN254 elliptic curve pairing-based verification |
| `UniswapPrivacyWrapper.sol` | Routes Uniswap V3 swaps through stealth proxies. Output lands in a fresh address. | Proxy pattern with stealth address output routing |

<br>

---

<br>

## Security Model

| Layer | Implementation |
|:------|:---------------|
| **Authentication** | Session token issued after passphrase verification. Required on every API call. Persisted in MongoDB with in-memory fallback — survives restarts and disk failures. |
| **Brute Force Protection** | Rate limited: 5 auth attempts per minute per IP address. Exponential backoff on repeated failures. |
| **Private Key Handling** | Generated client-side in browser memory. Returned once to the user for backup. Never stored in any database, server memory, or log file. |
| **Seed Phrase Policy** | Displayed once. Cleared from browser memory immediately after user confirms backup. Never transmitted to backend under any circumstance. |
| **Message Encryption** | `secp256k1` ECDH shared secret derivation + `AES-256-GCM` authenticated encryption. Server is zero-knowledge — processes only ciphertext. |
| **Wallet Session Hygiene** | WalletConnect and MetaMask session storage is wiped on disconnect. No tokens, keys, or state persist after logout. |
| **CORS Policy** | Locked exclusively to production domain. No wildcard origins. Preflight requests validated. |
| **API Surface** | `/docs` and `/openapi.json` endpoints disabled in production. No schema leakage. No route enumeration. |
| **Input Sanitization** | All MongoDB regex queries escaped. All user inputs validated and type-checked server-side. Injection-proof by design. |
| **Error Handling** | Generic error messages only. No stack traces, internal state, or database details exposed in any response. |
| **Request Limits** | 1 MB maximum request body. Payload size enforced at middleware level before any processing. |
| **Security Headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-XSS-Protection: 1; mode=block` on every response. |
| **MongoDB Security** | Database bound to `127.0.0.1` only. Not exposed to public internet. No remote access. |
| **Docker Isolation** | Application runs in isolated container. No host filesystem access. Minimal attack surface. |

<br>

---

<br>

## Deployment

### Docker (Recommended)

```bash
docker build -t upl .

docker run -d --name upl --restart always \
  -p 8001:8001 \
  -e MONGO_URL=mongodb://localhost:27017 \
  -e DB_NAME=privacycloak \
  -e ACCESS_CODE=<passphrase> \
  -e PAYOUT_WALLET=<your_wallet_address> \
  -e CORS_ORIGINS=https://yourdomain.com \
  upl
```

### Manual

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend
yarn install && yarn build
```

### Environment Variables

| Variable | Required | Description |
|:---------|:--------:|:------------|
| `MONGO_URL` | Yes | MongoDB connection string |
| `DB_NAME` | Yes | Database name |
| `ACCESS_CODE` | Yes | Passphrase for the access gate |
| `PAYOUT_WALLET` | Yes | Wallet address for receiving crypto payments |
| `CORS_ORIGINS` | Yes | Comma-separated list of allowed origins |

<br>

---

<br>

## Payments

<div align="center">

**Crypto-only. No card. No KYC. No intermediary.**

</div>

<br>

| Plan | Price | Who It's For | Payment Methods |
|:-----|:------|:-------------|:---------------|
| **Phantom** | $50 / 14-day trial | Solo operators who need to move in silence | Wallet &middot; QR Code &middot; Manual Transfer |
| **Specter** | $4,999 / month | Individuals demanding full privacy across all protocols | Wallet &middot; QR Code &middot; Manual Transfer |
| **Wraith** | $24,999 / month | Institutions and enterprises requiring dedicated infrastructure | Contact for custom onboarding |

<br>

**Accepted tokens:** ETH &middot; USDC &middot; USDT &middot; DAI &middot; MATIC &middot; BNB &middot; AVAX

**Accepted chains:** Ethereum &middot; Base &middot; Arbitrum &middot; Polygon &middot; Optimism &middot; BNB Chain &middot; Avalanche

<br>

---

<br>

## Technical Specifications

| Component | Specification |
|:----------|:-------------|
| **Backend** | Python 3.11, FastAPI, Motor (async MongoDB driver), httpx |
| **Frontend** | React 18, Tailwind CSS, ethers.js v6, Web3Modal v3, shadcn/ui |
| **Cryptography** | `@noble/secp256k1` v3.0.0, AES-256-GCM, ECDH, Groth16 |
| **Standard** | EIP-5564 (Stealth Addresses) |
| **Smart Contracts** | Solidity ^0.8.19 |
| **Database** | MongoDB 7, indexed collections, TTL-based session cleanup |
| **Containerization** | Multi-stage Docker (Node 20 Alpine + Python 3.11) |
| **TLS** | Let's Encrypt, auto-renewal via Certbot |
| **Infrastructure** | Nginx reverse proxy, Docker process isolation |

<br>

---

<br>

<div align="center">

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:00FF94,50:001a0e,100:000000&height=100&section=footer&fontSize=0" />

<br>

**[privacycloak.in](https://privacycloak.in)**

<br>

*Built for those who believe financial privacy is a right, not a feature.*

<br>

*All rights reserved.*

</div>
