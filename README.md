<div align="center">

# PrivacyCloak

**Privacy infrastructure for on-chain finance.**  
Trade, swap, send, and bet without your wallet being traced.

[![Status](https://img.shields.io/badge/status-private%20beta-brightgreen?style=flat-square)](https://privacycloak.in)
[![Chains](https://img.shields.io/badge/chains-9%20networks-blue?style=flat-square)](#networks)
[![API](https://img.shields.io/badge/API-REST%20%2B%20SDK-orange?style=flat-square)](#sdk)
[![License](https://img.shields.io/badge/license-private-red?style=flat-square)](#license)

**[privacycloak.in](https://privacycloak.in)**

</div>

---

## Why PrivacyCloak

Every on-chain action is permanently public. When you swap on Uniswap, open a Hyperliquid position, or place a Polymarket bet — your wallet, amount, and timing are visible to anyone forever. Wallets get profiled, front-run, and cross-protocol tracked.

PrivacyCloak routes every transaction through **stealth addresses** and **zero-knowledge proofs**. Your origin wallet is mathematically unlinkable from any destination, trade, or bet.

---

## Networks

| Network | Type | Token | Private Send | Private Swap | Private DeFi |
|---------|------|-------|:---:|:---:|:---:|
| Base | EVM L2 | ETH | ✓ | ✓ | Uniswap V3 |
| Arbitrum | EVM L2 | ETH | ✓ | ✓ | Uniswap V3, Hyperliquid |
| Polygon | EVM L1 | POL | ✓ | ✓ | Uniswap V3, Polymarket |
| Optimism | EVM L2 | ETH | ✓ | ✓ | Uniswap V3 |
| BNB Chain | EVM L1 | BNB | ✓ | ✓ | — |
| Avalanche | EVM L1 | AVAX | ✓ | ✓ | — |
| Hyperliquid | L1 Perps | HYPE | ✓ | — | 229 Perp Markets |
| Solana | SVM | SOL | ✓ | — | — |
| Sui | Move VM | SUI | ✓ | — | — |

---

## Features

### Privacy Primitives

**Stealth Addresses** — A unique one-time address is generated for every transaction using an ephemeral keypair. The recipient is the only one who can detect and claim it. No on-chain link between sender and receiver.

**Privacy Relayer** — A smart contract relayer submits transactions on behalf of users. Your wallet never appears as the transaction origin.

**Zero-Knowledge Proofs** — Groth16 proofs (built with Circom) let you prove ownership of funds, range constraints, or set membership — without revealing any underlying data.

**Cross-Chain Split** — Break a single transaction into multiple fragments sent across different chains simultaneously, eliminating amount fingerprinting.

---

### Private DeFi

**Uniswap V3** — Token swaps are routed through a stealth proxy. Quotes are fetched directly from the Uniswap V3 on-chain Quoter, with DeFiLlama as a price oracle fallback. The swap output lands in a stealth address — not your wallet.

**Hyperliquid** — Open perpetual futures positions with your margin routed through a fresh stealth proxy on each trade. 229 available markets, up to 50× leverage. Your wallet is never deposited into Hyperliquid directly.

**Polymarket** — Place prediction market bets with USDC routed through a stealth proxy. Your wallet never interacts with the Polymarket CLOB.

---

### Utilities

- **Hidden Balance** — Aggregated view of all funds held across your stealth addresses, per chain
- **Encrypted Messaging** — On-chain encrypted messages delivered between wallets
- **NFT Privacy** — Move NFTs without linking sender and receiver
- **Token Approval Privacy** — Manage approvals without on-chain fingerprinting
- **Multisig Privacy** — Multi-signature flows with hidden participant identities
- **PWA** — Installable as a mobile/desktop app with offline support

---

## How It Works

```
Your Wallet
     │
     ▼
 Access Gate  ──────────────────────────────────────────────────────────
 (passphrase → session token required on every API call)               │
     │                                                                  │
     ▼                                                                  │
Stealth Address Generator                                               │
(ephemeral keypair + view tag, unique per transaction)                 │
     │                                                                  │
     ├──────────────────────────────────────────────────────────────────┘
     │
     ├──→  Privacy Relayer Contract  ──────────→  Recipient Stealth Address
     │
     ├──→  Uniswap V3 Router  ────────────────→  Output Stealth Address
     │         ↑ quote from on-chain Quoter
     │           + DeFiLlama oracle fallback
     │
     ├──→  Hyperliquid L1  ─────────────────→  Fresh Stealth Margin Proxy
     │         ↑ 229 markets, up to 50× leverage
     │
     └──→  Polymarket CLOB  ───────────────→  Fresh Stealth USDC Proxy
               ↑ live markets from Polymarket API
```

---

## Repository

```
privacycloak/
│
├── backend/                    # FastAPI — privacy routing, chain interactions
│   ├── server.py               # 80+ endpoints across all features
│   └── requirements.txt
│
├── contracts/                  # Solidity smart contracts
│   ├── PrivacyRelayer.sol      # On-chain relayer for gasless transactions
│   ├── StealthAddressRegistry.sol
│   ├── UPLVerifier.sol         # ZKP verifier (wraps Groth16)
│   ├── Groth16Verifier.sol     # Circom-generated verifier
│   └── UniswapPrivacyWrapper.sol
│
├── frontend/                   # React 18 dashboard
│   └── src/
│       ├── App.js              # Full privacy dashboard
│       ├── components/         # Per-feature components
│       ├── context/            # Multi-chain wallet state
│       └── utils/              # Sanitized error monitoring
│
└── sdk/
    ├── js/                     # TypeScript SDK
    └── python/                 # Python SDK
```

---

## SDK

### Python

```bash
pip install upl-sdk
```

```python
from upl_sdk import UPL

upl = UPL(base_url="https://privacycloak.in", token="<session_token>")

# Private Uniswap V3 swap — real on-chain quote
quote = upl.get_uniswap_quote("base", "ETH", "USDC", "1.0", stealth_address)
# → { "amount_out_human": "2094.58", "routing": "relayer → uniswap_v3 → stealth" }

# Private Hyperliquid perp trade
trade = upl.prepare_hyperliquid_trade("0x...", "ETH", is_buy=True, size_usd=500, leverage=10)
# → { "proxy_address": "0x...", "routing": "wallet → stealth_proxy → hyperliquid" }

# Private Polymarket bet
bet = upl.prepare_polymarket_bet("0x...", condition_id, "1", "YES", amount_usdc=100)
# → { "proxy_address": "0x...", "estimated_payout_if_win": "$238.10" }

# Stealth address generation
stealth = upl.generate_stealth_address(spend_key, view_key)

# Hidden balance across all stealth addresses
balance = upl.get_hidden_balance("0x...")
```

### TypeScript

```typescript
import UPL from "upl-sdk";

const upl = new UPL({ baseUrl: "https://privacycloak.in", token: "<session_token>" });

// Private swap
const quote = await upl.getUniswapQuote({
  chain: "base",
  tokenIn: "ETH",
  tokenOut: "USDC",
  amountIn: "1.0",
  stealthRecipient: "0x..."
});

// Private perp trade
const trade = await upl.prepareHyperliquidTrade({
  traderAddress: "0x...",
  asset: "ETH",
  isBuy: true,
  sizeUsd: 500,
  leverage: 10
});
```

---

## Security

| Protection | Implementation |
|------------|---------------|
| API Authentication | Session token issued after passphrase auth. Required on every endpoint. |
| Brute Force | Rate limited: 5 auth attempts / minute per IP |
| Private Keys | Generated once, returned once, never stored in any database |
| Seed Phrases | Cleared from memory immediately after user confirms backup |
| Wallet History | WalletConnect + MetaMask session storage wiped on disconnect |
| CORS | Locked to production domain only |
| API Schema | `/docs` and `/openapi.json` disabled in production |
| Injection Protection | All MongoDB regex queries escaped |
| Error Responses | Generic messages only — no stack traces |
| Request Limits | 1 MB max body size enforced at middleware level |
| Security Headers | XSS, clickjacking, referrer policy on every response |

---

## Self-Hosting

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend && yarn && yarn start
```

**backend/.env**
```env
MONGO_URL=
DB_NAME=
CORS_ORIGINS=
ACCESS_CODE=
```

**frontend/.env**
```env
REACT_APP_BACKEND_URL=
```

---

<div align="center">

**Private Beta** · [privacycloak.in](https://privacycloak.in)

*All rights reserved.*

</div>
