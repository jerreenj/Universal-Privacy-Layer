# PrivacyCloak — Universal Privacy Layer
## PRD & Architecture Reference

### Original Problem Statement
Build a production-ready "Universal Privacy Layer" for cryptocurrency transactions.
- Privacy-preserving routing for DeFi (Hyperliquid, Polymarket, Uniswap)
- 7 EVM chains: Base, Arbitrum, Polygon, Optimism, BNB, Avalanche, Hyperliquid
- Stealth addresses + ZKP amount hiding
- Two modes: Public Mode (users) + Founder Mode (operator)

---

### Architecture
```
privacycloak/
├── backend/server.py          # FastAPI — token auth, rate limit, founder router
├── contracts/                 # 5 Solidity contracts (NOT YET DEPLOYED)
├── frontend/src/
│   ├── App.js                 # BrowserRouter: /founder → FounderMode, /* → PublicApp
│   ├── pages/FounderMode.jsx  # Isolated founder dashboard — no public links
│   └── config/chains.js       # 7 EVM chains config
├── sdk/js + sdk/python        # SDK skeletons
└── vercel.json                # SPA routing for Vercel deployment
```

### Security Model
- Public Mode: AccessGate → code "ROTATED-ACCESS-CODE" → session Bearer token → 8h TTL
- Founder Mode: `/founder` route → `X-Founder-Token` header → `ADMIN_TOKEN` env var
- Both use sessionStorage only (wiped on tab close)
- No cross-contamination between modes
- All `/api/*` protected by SecurityHeadersMiddleware (founder routes bypass to own auth)

### What's Implemented
| Feature | Status |
|---------|--------|
| Public access gate (code: ROTATED-ACCESS-CODE) | ✅ Done |
| Founder Mode dashboard | ✅ Done |
| 7-chain support | ✅ Done |
| DeFi integrations (Uniswap, Hyperliquid, Polymarket) | ✅ Done |
| Stealth address generation (off-chain) | ✅ Done |
| Vercel deployment (vercel.json) | ✅ Done |
| Contracts deployed on-chain | ❌ Pending — deployer wallet needs gas |
| On-chain stealth announcements | ❌ Pending — needs contracts deployed |
| Amount privacy (ZK fixed pools) | ❌ Pending — next phase |

### Founder Mode Endpoints
- `GET /api/founder/metrics` — real-time DB metrics
- `GET /api/founder/chains/health` — live RPC ping all 7 chains
- `GET /api/founder/activity` — recent transactions, stealth, trades
- `GET /api/founder/system` — backend health, DB collections, session count

### Deployer Wallet
- Address: `0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4`
- Status: UNFUNDED — needs gas on each chain to deploy contracts

### Access Credentials
- Public access code: `ROTATED-ACCESS-CODE`
- Founder token: stored in `ADMIN_TOKEN` env var in backend/.env

### Next Steps (Prioritized)
1. P0: Deploy StealthAddressRegistry + PrivacyRelayer to all 7 chains (requires wallet funding)
2. P1: On-chain stealth announcement flow (EIP-5564)
3. P2: Fixed denomination privacy pools (amount hiding — like Tornado Cash model)
4. P3: Full ZK proof amount hiding for arbitrary amounts
