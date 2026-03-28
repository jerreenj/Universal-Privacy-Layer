<div align="center">

<br>

<img src="https://img.shields.io/badge/%E2%96%88%E2%96%88%E2%96%88-UPL-00FF94?style=for-the-badge&labelColor=000000" alt="UPL" />

<br><br>

# Universal Privacy Layer

### The invisible backbone for on-chain finance.

[![Live](https://img.shields.io/badge/LIVE-privacycloak.in-00FF94?style=for-the-badge&labelColor=0a0a0a)](https://privacycloak.in)
[![Chains](https://img.shields.io/badge/NETWORKS-9-00F0FF?style=for-the-badge&labelColor=0a0a0a)](#-supported-networks)
[![Status](https://img.shields.io/badge/STATUS-PRIVATE%20BETA-FF3B30?style=for-the-badge&labelColor=0a0a0a)](#)

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

<br>

## The Solution

UPL makes your wallet **mathematically unlinkable** from any transaction.

Every operation — whether it's a token swap, a perp trade, a prediction bet, or a simple transfer — is routed through a freshly generated **stealth address** backed by **zero-knowledge cryptography**. The origin wallet and the destination exist in two completely separate on-chain realities. No link. No trace. No fingerprint.

```
  You                                          The Blockchain
   |                                                 |
   |   [Stealth Address Generation]                  |
   |   [ZK Proof Construction]                       |
   |   [Cross-Chain Fragmentation]                   |
   |                                                 |
   └──── mathematically unlinkable ────────────────> |
                                                     |
         No link. No trace. No fingerprint.          |
```

<br>

---

<br>

## Supported Networks

<table>
<tr>
<th>Network</th>
<th>Type</th>
<th>Native Token</th>
<th align="center">Private Send</th>
<th align="center">Private Swap</th>
<th>Private DeFi</th>
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
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>229 Perpetual Markets</td>
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

</td>
<td width="50%">

### Zero-Knowledge Proofs
Groth16 proofs (constructed with Circom circuits) enable you to prove ownership of funds, satisfy range constraints, or demonstrate set membership — **without revealing any underlying data.** The blockchain verifies the proof. It never sees the secret.

</td>
</tr>
<tr>
<td>

### Privacy Relayer
A dedicated smart contract relayer submits transactions on behalf of the user. Your wallet address **never appears as the transaction origin.** Gas is abstracted. The relayer is the only address visible on-chain.

</td>
<td>

### Cross-Chain Fragmentation
A single transaction is broken into multiple fragments and dispatched across **different chains simultaneously.** Amount correlation analysis — one of the most effective de-anonymization techniques — becomes computationally infeasible.

</td>
</tr>
</table>

<br>

---

<br>

## Private DeFi Integrations

### Uniswap V3
Token swaps are routed through a stealth proxy contract. Quotes are fetched directly from the Uniswap V3 on-chain Quoter contract, with DeFiLlama as a price oracle fallback. The swap output lands in a **freshly generated stealth address** — your wallet never touches the DEX.

### Hyperliquid
Open perpetual futures positions with your margin routed through a fresh stealth proxy on every trade. Access to **229 available markets** with up to **50x leverage.** Your wallet is never deposited into Hyperliquid directly. Every position is isolated behind a unique ephemeral address.

### Polymarket
Place prediction market bets with USDC routed through a stealth proxy. Your wallet **never interacts with the Polymarket CLOB.** Bet, win, and withdraw — all through one-time stealth addresses that cannot be linked back to your identity.

<br>

---

<br>

## Additional Capabilities

| Feature | Description |
|---------|-------------|
| **End-to-End Encrypted Messaging** | `secp256k1` ECDH key agreement + `AES-256-GCM` symmetric encryption. Server processes only ciphertext. Even UPL cannot read your messages. |
| **Hidden Balance Aggregation** | Unified view of all funds held across your stealth addresses, broken down by chain. No external observer can reconstruct the full picture. |
| **NFT Privacy Transfer** | Move NFTs between wallets without creating an on-chain link between sender and receiver. |
| **Token Approval Privacy** | Manage ERC-20 approvals through stealth proxies to prevent on-chain approval fingerprinting. |
| **Multisig Privacy Vaults** | Multi-signature wallet flows with hidden participant identities. Signers are never revealed on-chain. |
| **Progressive Web App** | Installable on mobile and desktop with offline caching and service worker support. |

<br>

---

<br>

## Architecture

```
Universal-Privacy-Layer/
│
├── backend/                        Python 3.11 · FastAPI
│   ├── server.py                   80+ API endpoints
│   │   ├── Session Auth            Passphrase → token, rate-limited, MongoDB-persisted
│   │   ├── Stealth Engine          EIP-5564 address generation, announcement relay
│   │   ├── Privacy Router          Cross-chain splits, relayer dispatch
│   │   ├── DeFi Integrations       Uniswap V3, Hyperliquid, Polymarket
│   │   ├── Encrypted Messaging     E2E + legacy fallback
│   │   └── Crypto Payments         Direct wallet, QR, MetaMask connect
│   └── requirements.txt
│
├── contracts/                      Solidity · EVM Smart Contracts
│   ├── PrivacyRelayer.sol          Gasless transaction relay
│   ├── StealthAddressRegistry.sol  On-chain stealth announcement registry
│   ├── UPLVerifier.sol             ZK proof verification wrapper
│   ├── Groth16Verifier.sol         Circom-generated Groth16 verifier
│   └── UniswapPrivacyWrapper.sol   Stealth-routed Uniswap interactions
│
├── frontend/                       React 18 · Tailwind · ethers.js
│   └── src/
│       ├── App.js                  Minimal router (60 lines)
│       ├── components/             25+ modular feature components
│       │   ├── auth/               Access gate
│       │   ├── features/           Stealth, messaging, DeFi, NFT, multisig
│       │   ├── layout/             Navbar, dashboard, landing
│       │   ├── common/             Shared utilities
│       │   └── ui/                 shadcn/ui primitives + pricing
│       ├── pages/                  Pricing page
│       ├── config/                 Chain registry, RPC endpoints
│       ├── context/                Multi-chain wallet state (WalletContext)
│       ├── lib/                    messageCrypto (ECDH), session management
│       └── utils/                  stealth.js (EIP-5564 secp256k1 math)
│
└── Dockerfile                      Multi-stage production build
```

<br>

---

<br>

## System Flow

```
                              ┌─────────────────────────────────┐
                              │         ACCESS GATE             │
                              │  Passphrase → Session Token     │
                              │  (rate-limited, 1-year TTL)     │
                              └───────────────┬─────────────────┘
                                              │
                              ┌───────────────▼─────────────────┐
                              │    STEALTH ADDRESS GENERATOR    │
                              │  EIP-5564 · secp256k1 · ECDH   │
                              │  Ephemeral keypair per tx       │
                              └───────────────┬─────────────────┘
                                              │
                 ┌────────────────┬───────────┼───────────┬────────────────┐
                 │                │           │           │                │
                 ▼                ▼           ▼           ▼                ▼
          ┌─────────────┐ ┌────────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐
          │   Privacy   │ │  Uniswap   │ │ Hyper- │ │  Poly-   │ │ Cross-Chain │
          │   Relayer   │ │  V3 Swap   │ │ liquid │ │  market  │ │    Split    │
          │  Contract   │ │  via Proxy │ │  Perps │ │  Bets    │ │  Fragments  │
          └──────┬──────┘ └─────┬──────┘ └───┬────┘ └────┬─────┘ └──────┬──────┘
                 │              │             │           │              │
                 ▼              ▼             ▼           ▼              ▼
          ┌──────────────────────────────────────────────────────────────────┐
          │              DESTINATION STEALTH ADDRESS                        │
          │         (mathematically unlinkable from origin)                 │
          └──────────────────────────────────────────────────────────────────┘
```

<br>

---

<br>

## Security Model

| Layer | Implementation |
|-------|---------------|
| **Authentication** | Session token issued after passphrase verification. Required on every API call. Persisted in MongoDB — survives restarts. |
| **Brute Force Protection** | Rate limited: 5 auth attempts per minute per IP address. |
| **Private Key Handling** | Generated client-side, returned once to the user, never stored in any database or server memory. |
| **Seed Phrase Policy** | Cleared from browser memory immediately after user confirms backup. Never transmitted to backend. |
| **Message Encryption** | `secp256k1` ECDH shared secret derivation + `AES-256-GCM` authenticated encryption. Server is zero-knowledge. |
| **Wallet Session Hygiene** | WalletConnect and MetaMask session storage is wiped on disconnect. No residual state. |
| **CORS Policy** | Locked exclusively to production domain. No wildcard origins. |
| **API Surface** | `/docs` and `/openapi.json` endpoints are disabled in production. No schema leakage. |
| **Input Sanitization** | All MongoDB regex queries are escaped. All user inputs are validated server-side. |
| **Error Handling** | Generic error messages only. No stack traces, no internal state exposure in any response. |
| **Request Limits** | 1 MB maximum request body enforced at middleware level. |
| **Security Headers** | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-XSS-Protection` on every response. |

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

| Variable | Description |
|----------|-------------|
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name |
| `ACCESS_CODE` | Passphrase for the access gate |
| `PAYOUT_WALLET` | Wallet address for receiving payments |
| `CORS_ORIGINS` | Comma-separated allowed origins |

<br>

---

<br>

## Pricing

Crypto-only. No card. No KYC. No intermediary.

| Plan | Price | For |
|------|-------|-----|
| **Phantom** | $50 / 14-day trial | Solo operators |
| **Specter** | $4,999 / month | Individuals demanding full privacy |
| **Wraith** | $24,999 / month | Institutions and enterprises |

Accepted tokens: **ETH, USDC, USDT, DAI, MATIC, BNB, AVAX** across all supported chains.

<br>

---

<br>

<div align="center">

**[privacycloak.in](https://privacycloak.in)**

Built for those who believe financial privacy is a right, not a feature.

*All rights reserved.*

</div>
