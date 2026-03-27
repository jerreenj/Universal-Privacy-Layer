# PrivacyCloak

**On-chain privacy infrastructure for EVM. Send, swap, trade, and bet — completely anonymously.**

[privacycloak.in](https://privacycloak.in) · Private Beta

---

## Overview

PrivacyCloak routes every transaction through stealth addresses and zero-knowledge proofs so your wallet is never linked to your on-chain activity.

Works on Base, Arbitrum, Polygon, Optimism, BNB Chain, Avalanche, and Hyperliquid.

---

## What's Inside

```
├── backend/          FastAPI — privacy routing, chain interactions, DeFi integrations
├── frontend/         React — full privacy dashboard
├── contracts/        Solidity — relayer, stealth registry, ZKP verifier
├── circuits/         Circom — zero-knowledge circuits (Groth16)
└── sdk/              Python + TypeScript SDKs
```

---

## Features

- **Private Send** — ETH and ERC-20 transfers through stealth addresses
- **Private Swap** — Uniswap V3 swaps via privacy relayer (real on-chain quotes)
- **Private Perp Trading** — Hyperliquid positions through stealth margin proxy
- **Private Prediction Bets** — Polymarket bets through stealth USDC proxy
- **ZK Proofs** — Groth16 proof generation and on-chain verification
- **Cross-Chain Split** — Split transactions across multiple chains simultaneously
- **Hidden Balance** — Aggregate balance across all stealth addresses
- **Encrypted Messaging** — On-chain encrypted messages between wallets
- **Developer API** — Full REST API with session authentication

---

## SDK

**Python**
```bash
pip install upl-sdk
```
```python
from upl_sdk import UPL

upl = UPL(base_url="https://privacycloak.in", token="...")

# Private swap quote
quote = upl.get_uniswap_quote("base", "ETH", "USDC", "0.5", stealth_address)

# Private perp trade
trade = upl.prepare_hyperliquid_trade("0x...", "ETH", is_buy=True, size_usd=100, leverage=5)

# Private prediction bet
bet = upl.prepare_polymarket_bet("0x...", condition_id, "1", "YES", 50.0)
```

**TypeScript**
```bash
npm install upl-sdk
```
```typescript
import UPL from "upl-sdk";
const upl = new UPL({ baseUrl: "https://privacycloak.in", token: "..." });

const quote = await upl.getUniswapQuote({ chain: "base", tokenIn: "ETH", tokenOut: "USDC", amountIn: "0.5", stealthRecipient: "0x..." });
```

---

## Self-Hosting

**Requirements:** Node 18+, Python 3.11+, MongoDB

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend && yarn && yarn start
```

**backend/.env**
```
MONGO_URL=
DB_NAME=
CORS_ORIGINS=
ACCESS_CODE=
ADMIN_TOKEN=
```

**frontend/.env**
```
REACT_APP_BACKEND_URL=
```

---

## License

Private. All rights reserved.
