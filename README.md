# PrivacyCloak

**Privacy infrastructure for on-chain finance. Trade, swap, send, and bet without your wallet being traced.**

[![Status](https://img.shields.io/badge/status-private%20beta-green)](https://privacycloak.in)
[![Chains](https://img.shields.io/badge/chains-7%20EVM-blue)](#supported-chains)
[![License](https://img.shields.io/badge/license-private-red)](#license)

---

## The Problem

Every on-chain action is public. When you swap on Uniswap, open a Hyperliquid position, or place a Polymarket bet — your wallet address, amount, and timing are permanently visible to anyone. Wallets get profiled, front-run, and tracked across protocols.

## The Solution

PrivacyCloak routes every transaction through stealth addresses and on-chain relayers. Your origin wallet is mathematically unlinkable from any destination, trade, or bet. Zero-knowledge proofs verify ownership without revealing identity.

---

## Supported Chains

| Chain | Type | Native Token |
|-------|------|-------------|
| Base | L2 (Coinbase) | ETH |
| Arbitrum | L2 (Offchain Labs) | ETH |
| Polygon | L1 sidechain | POL |
| Optimism | L2 (OP Stack) | ETH |
| BNB Chain | L1 | BNB |
| Avalanche | L1 | AVAX |
| Hyperliquid | L1 (perps) | HYPE |

---

## Features

### Core Privacy
| Feature | Description |
|---------|-------------|
| Stealth Addresses | One-time addresses generated per transaction. Recipient is unlinkable. |
| Privacy Relayer | On-chain relayer submits transactions so your wallet never signs publicly. |
| ZK Proofs | Groth16 proofs (Circom) verify ownership without revealing the owner. |
| Hidden Balance | Aggregate view across all your stealth addresses per chain. |

### Private DeFi
| Integration | What's Private |
|-------------|---------------|
| Uniswap V3 | Token swaps routed through a stealth proxy. Real quotes via on-chain Quoter + DeFiLlama oracle. |
| Hyperliquid | Perpetual positions opened via a stealth margin proxy. 229 markets, up to 50x leverage. |
| Polymarket | USDC bets placed via a stealth proxy. Your wallet never touches the prediction market. |

### Utilities
- **Private Send** — Transfer ETH or any ERC-20 through a stealth address
- **Cross-Chain Split** — Split a single transaction across multiple chains simultaneously
- **Encrypted Messaging** — On-chain encrypted messages between wallets
- **NFT Privacy** — Transfer NFTs without linking sender and recipient
- **Token Approval Privacy** — Revoke or grant approvals without on-chain fingerprinting
- **Multisig Privacy** — Multi-signature flows with hidden participant identities

---

## Architecture

```
User Wallet
     │
     ▼
 Access Gate ──── session token required on every API call
     │
     ▼
Stealth Address Generator
(ephemeral keypair + view tag per transaction)
     │
     ├──→ Privacy Relayer Contract ───→ Recipient Stealth Address
     ├──→ Uniswap V3 Router ──────────→ Output to Stealth Address  
     ├──→ Hyperliquid L1 ─────────────→ Via Fresh Stealth Margin Proxy
     └──→ Polymarket CLOB ────────────→ Via Fresh Stealth USDC Proxy
```

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Ethers.js v6, Tailwind CSS, Framer Motion |
| Backend | FastAPI (Python 3.11), Motor (async MongoDB) |
| Smart Contracts | Solidity 0.8, Hardhat |
| ZK Circuits | Circom 2, snarkjs, Groth16 |
| Wallet | MetaMask, Phantom, WalletConnect |
| Price Oracle | DeFiLlama (free, no rate limits) + Uniswap V3 on-chain Quoter |

---

## Repository Structure

```
├── backend/
│   ├── server.py          # 2,700+ lines — all API logic, 80+ endpoints
│   └── requirements.txt
│
├── contracts/             # Solidity smart contracts
│   ├── PrivacyRelayer.sol
│   ├── StealthAddressRegistry.sol
│   ├── UPLVerifier.sol
│   ├── Groth16Verifier.sol
│   └── UniswapPrivacyWrapper.sol
│
├── circuits/              # Zero-knowledge circuits (Circom)
│   └── sources/
│       ├── stealth_ownership.circom
│       ├── amount_range.circom
│       └── membership.circom
│
├── frontend/
│   └── src/
│       ├── App.js                      # Main dashboard
│       ├── components/features/        # Per-feature components
│       ├── context/WalletContext.jsx   # Multi-chain wallet state
│       └── utils/errorMonitor.js      # Sanitized error tracking
│
└── sdk/
    ├── js/                # TypeScript SDK
    └── python/            # Python SDK
```

---

## SDK

**Python**
```bash
pip install upl-sdk
```
```python
from upl_sdk import UPL

upl = UPL(base_url="https://privacycloak.in", token="<session_token>")

# Private Uniswap V3 swap quote
quote = upl.get_uniswap_quote("base", "ETH", "USDC", "1.0", stealth_address)
# → {"amount_out_human": "2094.58", "routing": "relayer → uniswap_v3 → stealth"}

# Private Hyperliquid perpetual trade
trade = upl.prepare_hyperliquid_trade("0x...", "ETH", is_buy=True, size_usd=500, leverage=10)
# → {"proxy_address": "0x...", "instructions": [...]}

# Private Polymarket bet
bet = upl.prepare_polymarket_bet("0x...", condition_id, "1", "YES", amount_usdc=100)
# → {"proxy_address": "0x...", "estimated_payout_if_win": "$238.10"}

# Hidden balance across all stealth addresses
balance = upl.get_hidden_balance("0x...")
```

**TypeScript**
```typescript
import UPL from "upl-sdk";

const upl = new UPL({ baseUrl: "https://privacycloak.in", token: "<session_token>" });

const quote = await upl.getUniswapQuote({
  chain: "base", tokenIn: "ETH", tokenOut: "USDC",
  amountIn: "1.0", stealthRecipient: "0x..."
});

const trade = await upl.prepareHyperliquidTrade({
  traderAddress: "0x...", asset: "ETH",
  isBuy: true, sizeUsd: 500, leverage: 10
});
```

---

## Security

- All API endpoints require a short-lived session token issued after passphrase authentication
- Seed phrases and private keys are generated client-side, shown once, and never written to any database
- WalletConnect and MetaMask session history wiped from storage on every disconnect
- CORS locked to the production domain only
- Rate limiting on all sensitive endpoints (auth, wallet creation)
- API schema (`/docs`, `/openapi.json`) disabled in production
- MongoDB query injection protection on all inputs
- Security headers on all responses (XSS, clickjacking, referrer policy)

---

## Self-Hosting

**Requirements:** Node 18+, Python 3.11+, MongoDB

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend  
cd frontend
yarn install && yarn start
```

**backend/.env**
```env
MONGO_URL=
DB_NAME=
CORS_ORIGINS=
ACCESS_CODE=
ADMIN_TOKEN=
```

**frontend/.env**
```env
REACT_APP_BACKEND_URL=
```

---

## License

Private — All rights reserved.
