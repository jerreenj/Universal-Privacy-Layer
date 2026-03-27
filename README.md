# PrivacyCloak — Universal Privacy Layer

> **On-chain privacy for every transaction. Stealth addresses, ZK proofs, private DeFi — across 7 EVM chains.**

Live at **[privacycloak.in](https://privacycloak.in)**

---

## What It Does

PrivacyCloak is a production-grade privacy infrastructure for EVM blockchains. It lets users send, swap, trade, and bet on-chain without their wallet being linked to any activity.

- **Private Send** — Transfer ETH/ERC-20 through stealth addresses. Recipient is unlinkable.
- **Private Swap** — Uniswap V3 swaps routed through a privacy relayer. Real on-chain quotes via DeFiLlama oracle.
- **Private Perp Trading** — Open Hyperliquid perpetual positions through a stealth margin proxy. 229 markets.
- **Private Prediction Bets** — Place Polymarket bets through a stealth USDC proxy. Identity stays hidden.
- **Hidden Balance** — Aggregate view of all balances across stealth addresses and chains.
- **ZK Proof Verification** — Groth16 proofs via Circom circuits, verified on-chain.
- **Cross-Chain Split** — Split a transaction across multiple chains simultaneously.
- **Encrypted Messaging** — On-chain encrypted message delivery between addresses.
- **On-Chain Relayer** — Gasless meta-transactions via a privacy relayer contract.
- **NFT Privacy** — Transfer NFTs through stealth addresses.
- **Multisig Privacy** — Multi-signature approvals with hidden participant identities.
- **Developer API** — Full REST API with session auth for third-party integrations.

---

## Supported Chains

| Chain | Network | Token |
|-------|---------|-------|
| Base | Mainnet | ETH |
| Arbitrum | Mainnet | ETH |
| Polygon | Mainnet | MATIC |
| Optimism | Mainnet | ETH |
| BNB Chain | Mainnet | BNB |
| Avalanche | Mainnet | AVAX |
| Hyperliquid | L1 | HYPE |

---

## Architecture

```
privacycloak/
├── backend/               # FastAPI — all API logic, privacy routing, chain interactions
│   ├── server.py          # Main API server (2,700+ lines, 80+ endpoints)
│   └── requirements.txt
│
├── frontend/              # React — full privacy dashboard UI
│   ├── src/
│   │   ├── App.js         # Main app + all feature components
│   │   ├── components/
│   │   │   └── features/  # UniswapPrivateSwap, HyperliquidTrading, PolymarketBetting, HiddenBalance
│   │   ├── context/
│   │   │   └── WalletContext.jsx   # EVM + Solana + Sui wallet management
│   │   ├── config/
│   │   │   └── chains.js           # Chain configs, RPC URLs, token lists
│   │   ├── pages/                  # Terms, Privacy Policy, Onboarding
│   │   └── utils/
│   │       └── errorMonitor.js     # Client-side error tracking (sanitized)
│   └── public/
│       ├── manifest.json           # PWA manifest
│       └── service-worker.js       # Offline support
│
├── contracts/             # Solidity smart contracts + deployment scripts
│   ├── PrivacyRelayer.sol          # On-chain relayer contract
│   ├── StealthAddressRegistry.sol  # Stealth address registry
│   ├── UPLVerifier.sol             # ZKP verifier (Groth16)
│   ├── UniswapPrivacyWrapper.sol   # Uniswap V3 privacy wrapper
│   ├── Groth16Verifier.sol         # Circom-generated verifier
│   └── deploy*.py                  # Chain-specific deployment scripts
│
├── circuits/              # ZK circuits (Circom)
│
├── sdk/
│   ├── js/                # TypeScript SDK — 17 async methods
│   └── python/            # Python SDK — 19 methods (pip installable)
│
├── docs/
│   ├── ZKP_IMPLEMENTATION_GUIDE.md
│   ├── SOLANA_DEPLOYMENT_GUIDE.md
│   └── SUI_DEPLOYMENT_GUIDE.md
│
└── scripts/               # Deployment utilities
```

---

## Security Model

- **Access Gate** — Session token issued server-side after passphrase verification. Token required on every API call. Brute force rate-limited (5 attempts/min).
- **No Private Keys Stored** — Seed phrases and private keys are generated, shown once, and never written to any database.
- **Seed Phrases Wiped** — Cleared from React memory immediately after user confirms backup.
- **Wallet Session Cleanup** — All WalletConnect/MetaMask session storage wiped on disconnect.
- **CORS Locked** — API accepts requests only from `privacycloak.in`.
- **Security Headers** — XSS protection, clickjacking prevention, referrer policy on all responses.
- **MongoDB Injection Protection** — All regex queries escaped via `re.escape()`.
- **No Stack Traces in Responses** — Generic error messages returned to clients.
- **Docs Disabled** — FastAPI `/docs` and `/openapi.json` are disabled in production.
- **Request Size Limit** — 1 MB max body size enforced at middleware level.

---

## Privacy Architecture

```
User Wallet
    │
    ▼
Access Gate (passphrase + session token)
    │
    ▼
Stealth Address Generator
(ephemeral key + view tag)
    │
    ├──► Privacy Relayer Contract ──► Recipient Stealth Address
    │
    ├──► Uniswap V3 Router ──────────► Output to Stealth Address
    │
    ├──► Hyperliquid L1 ─────────────► Via Stealth Margin Proxy
    │
    └──► Polymarket CLOB ────────────► Via Stealth USDC Proxy
```

All routing goes through a freshly generated stealth proxy per transaction. The origin wallet is never linked to the destination.

---

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- MongoDB

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```

### Frontend
```bash
cd frontend
yarn install
yarn start
```

### Environment Variables

**backend/.env**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=your_db_name
CORS_ORIGINS=https://yourdomain.com
ACCESS_CODE=your_secret_passphrase
ADMIN_TOKEN=your_admin_token
```

**frontend/.env**
```
REACT_APP_BACKEND_URL=https://your-api-url.com
```

---

## SDK

### Python
```python
from upl_sdk import UPL

upl = UPL(base_url="https://privacycloak.in")

# Get Uniswap V3 quote (privacy-routed)
quote = upl.get_uniswap_quote("base", "ETH", "USDC", "0.5", "0x...")
print(quote["amount_out_human"])  # e.g. "1047.29"

# Prepare Hyperliquid private trade
trade = upl.prepare_hyperliquid_trade("0x...", "ETH", True, 100, leverage=5)
print(trade["proxy_address"])  # Send margin here

# Prepare Polymarket private bet
bet = upl.prepare_polymarket_bet("0x...", "condition_id", "1", "YES", 50.0)
print(bet["proxy_address"])  # Send USDC here
```

### JavaScript
```typescript
import UPL from "upl-sdk";

const upl = new UPL({ baseUrl: "https://privacycloak.in" });

const quote = await upl.getUniswapQuote({
  chain: "base", tokenIn: "ETH", tokenOut: "USDC",
  amountIn: "0.5", stealthRecipient: "0x..."
});
```

---

## Deployer Wallet

**Address:** `0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4`

Fund this wallet with gas tokens (ETH, MATIC, BNB, AVAX) before deploying contracts.

---

## License

Private — All rights reserved. Not open source.
