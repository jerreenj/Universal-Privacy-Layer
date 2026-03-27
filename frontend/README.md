# PrivacyCloak — Frontend

React dashboard for the Universal Privacy Layer.

## Features
- Access gate (passphrase protected, server-side token auth)
- Private Send, Swap, Receive via stealth addresses
- Uniswap V3 private swaps (real on-chain quotes)
- Hyperliquid private perp trading (229 markets)
- Polymarket private prediction bets
- Hidden balance aggregator across 7 chains
- ZK proof submission and verification
- Cross-chain split transactions
- Encrypted on-chain messaging
- PWA installable (manifest + service worker)
- Developer API explorer

## Stack
- React 18, Ethers.js v6, Axios
- Tailwind CSS, Framer Motion, Lucide React
- Sonner (toasts), D3.js (charts)

## Run
```bash
yarn install && yarn start
```

## Environment
```
REACT_APP_BACKEND_URL=https://privacycloak.in
```
