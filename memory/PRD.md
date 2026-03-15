# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 2026

## DEPLOYED - LIVE ON 6 MAINNETS

### Contract Addresses (identical on all 6 chains — deterministic deployer nonce)
| Contract | Address |
|----------|---------|
| **PrivacyRelayer** | `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c` |
| **StealthAddressRegistry** | `0xf2E7A6734E58774A8417c176AaE3898667699Ff4` |

### Live Chains
| Chain | Chain ID | Status | Explorer |
|-------|----------|--------|---------|
| **Base** | 8453 | ✅ Live | https://basescan.org |
| **Arbitrum One** | 42161 | ✅ Live | https://arbiscan.io |
| **Polygon** | 137 | ✅ Live | https://polygonscan.com |
| **Optimism** | 10 | ✅ Live | https://optimistic.etherscan.io |
| **BNB Chain** | 56 | ✅ Live | https://bscscan.com |
| **Avalanche C-Chain** | 43114 | ✅ Live | https://snowtrace.io |

---

## UI Features
- ✅ Black & white rotating wireframe globe (d3.js)
- ✅ MagnetizeButton for wallet connection (particles animation)
- ✅ Clear "← Back" button on all sub-pages
- ✅ Navbar with 6-chain live selector
- ✅ Page-based navigation (Home, Receive, Send, Swap, Chain Status)
- ✅ Real-time balance display per chain
- ✅ 6-chain pill row on landing
- ✅ Roadmap list (Solana, Bitcoin, Sui, Hyperliquid)
- ✅ Chain dropdown with explorer links
- ✅ Chain Status page (live/roadmap sections)
- ✅ Mobile responsive

---

## Architecture
- **Frontend**: React.js + Ethers.js + Lucide icons
- **Backend**: FastAPI + MongoDB
- **Smart Contracts**: 2 Solidity contracts, deployed on 6 EVM mainnets
- **Wallet**: MetaMask via window.ethereum / BrowserProvider

---

## Roadmap (Non-EVM — needs separate implementation)
- **Solana**: Needs Anchor/Rust programs
- **Bitcoin**: Needs Lightning or Stacks layer
- **Sui**: Needs Move smart contracts
- **Hyperliquid**: HyperEVM layer — future roadmap

---

## API Endpoints
- `GET /api/health`
- `GET /api/chains` — returns 6 live chains with contract addresses
- `GET /api/tokens/{chain}` — returns tokens for a chain
- `GET /api/deployer-info`
- `POST /api/stealth/generate` — generates stealth address
- `POST /api/swap/quote` — swap quote (0.05% fee)
- `POST /api/wallet/create`
- `POST /api/receipt/create` / `POST /api/receipt/decrypt`
- `GET /api/transactions/{address}`

---

## Deployer Wallet
- Address: `0x77483a981724fDa225EF78D8d3CF3c57a30193da`

## Remaining Tasks (Backlog)
- P1: UniswapWrapper contract deployment (requires compiling with OpenZeppelin)
- P1: ZKP guide (Circom + snarkjs integration)
- P2: Solana privacy program (Anchor/Rust)
- P2: Portfolio view (cross-chain balance aggregator)
- P3: Bitcoin Lightning layer
- P3: Sui Move contracts
- P3: Hyperliquid HyperEVM
