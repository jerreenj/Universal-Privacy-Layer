# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 2026

## DEPLOYED - LIVE ON 4 MAINNETS

### Contract Addresses (same on all chains — deterministic deployer nonce)
| Contract | Address |
|----------|---------|
| **PrivacyRelayer** | `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c` |
| **StealthAddressRegistry** | `0xf2E7A6734E58774A8417c176AaE3898667699Ff4` |

### Live Chains
| Chain | Status | Explorer |
|-------|--------|---------|
| **Base Mainnet** (8453) | ✅ Live | https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c |
| **Arbitrum One** (42161) | ✅ Live | https://arbiscan.io/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c |
| **Polygon** (137) | ✅ Live | https://polygonscan.com/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c |
| **Optimism** (10) | ✅ Live | https://optimistic.etherscan.io/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c |

---

## UI Features
- ✅ Black & white rotating wireframe globe (d3.js)
- ✅ MagnetizeButton for wallet connection (particles animation)
- ✅ Clear "← Back" button on all sub-pages
- ✅ Clean navbar with live chain selector (4 chains)
- ✅ Page-based navigation (Home, Receive, Send, Swap, Chain Status)
- ✅ Real-time balance display per chain
- ✅ 4-chain pill row on landing (Base, Arbitrum, Polygon, Optimism)
- ✅ Coming Soon pills (BNB Chain, Avalanche)
- ✅ Roadmap list (Solana, Bitcoin, Sui, Hyperliquid)
- ✅ Chain dropdown with explorer links
- ✅ Chain Status page (live/coming soon/roadmap sections)
- ✅ Mobile responsive

---

## Architecture
- **Frontend**: React.js + Ethers.js + Lucide icons
- **Backend**: FastAPI + MongoDB
- **Smart Contracts**: Solidity (2 contracts deployed cross-chain)
- **Wallet**: MetaMask via window.ethereum / BrowserProvider

---

## Coming Soon (EVM chains — needs deployer wallet funding)
- **BNB Chain** (56): EVM-compatible, same contracts deployable
- **Avalanche C-Chain** (43114): EVM-compatible, same contracts deployable

## Roadmap (Non-EVM — needs separate implementation)
- **Solana**: Needs Anchor/Rust programs
- **Bitcoin**: Needs Lightning or Stacks layer
- **Sui**: Needs Move smart contracts
- **Hyperliquid**: HyperEVM layer — future roadmap

---

## API Endpoints
- `GET /api/health`
- `GET /api/chains` — returns 4 live chains with contract addresses
- `GET /api/tokens/{chain}` — returns tokens for a chain
- `POST /api/stealth/generate` — generates stealth address
- `POST /api/swap/quote` — swap quote (0.05% fee)
- `GET /api/deployer-info`
- `POST /api/wallet/create`
- `POST /api/receipt/create` / `POST /api/receipt/decrypt`
- `GET /api/transactions/{address}`

---

## Deployer Wallet
- Address: `0x77483a981724fDa225EF78D8d3CF3c57a30193da`
- Deployment RPC (Polygon): `https://rpc-mainnet.matic.quiknode.pro`
