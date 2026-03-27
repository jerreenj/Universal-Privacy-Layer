# PrivacyCloak — Backend

FastAPI backend for the Universal Privacy Layer.

## Endpoints (80+)

### Auth
- `POST /api/auth/verify-access` — Verify passphrase, receive session token

### Privacy Core
- `POST /api/stealth/generate` — Generate stealth address
- `POST /api/stealth/scan` — Scan for stealth transactions
- `GET  /api/balance/hidden/{address}` — Aggregated hidden balance

### DeFi Integrations
- `POST /api/uniswap/quote` — Privacy-routed Uniswap V3 quote (DeFiLlama oracle)
- `POST /api/uniswap/record-swap` — Record executed swap
- `GET  /api/hyperliquid/markets` — 229 live perpetual markets
- `GET  /api/hyperliquid/price/{asset}` — Live mark price
- `POST /api/hyperliquid/prepare-private-trade` — Stealth margin proxy trade
- `GET  /api/polymarket/markets` — Live prediction markets
- `POST /api/polymarket/prepare-private-bet` — Stealth USDC proxy bet

### Transactions
- `POST /api/transactions/private-send` — Privacy-routed send
- `GET  /api/transactions/history/{address}` — Transaction history
- `POST /api/relay/submit` — Submit via on-chain relayer

### ZKP
- `POST /api/zkp/generate-proof` — Generate Groth16 proof
- `POST /api/zkp/verify` — Verify ZK proof on-chain

### Wallet
- `POST /api/wallet/create` — Create dual-key wallet (seeds returned once, never stored)
- `POST /api/wallet/register-privacy` — Register privacy keys

## Security
- Session token required on all endpoints except `/health` and `/auth/verify-access`
- Rate limiting: 5 auth attempts/min, 3 wallet creates/min, 20 general calls/min
- CORS locked to `privacycloak.in`
- MongoDB injection protection (`re.escape` on all regex queries)
- No stack traces in responses
- `/docs` and `/openapi.json` disabled in production

## Run
```bash
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```

## Environment
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=your_db
CORS_ORIGINS=https://privacycloak.in
ACCESS_CODE=your_passphrase
ADMIN_TOKEN=your_admin_token
```
