# Universal Privacy Layer (UPL) - PRD

**Last Updated:** Jan 2026

## DEPLOYED - LIVE ON BASE MAINNET

### Contracts
| Contract | Address | BaseScan |
|----------|---------|----------|
| **PrivacyRelayer** | `0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c` | [View](https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c) |
| **StealthRegistry** | `0xf2E7A6734E58774A8417c176AaE3898667699Ff4` | [View](https://basescan.org/address/0xf2E7A6734E58774A8417c176AaE3898667699Ff4) |

### Deployer Wallet
- Address: `0x77483a981724fDa225EF78D8d3CF3c57a30193da`
- Remaining: ~0.0095 ETH (~$24)

---

## Features Implemented

### UI
- ✅ Rotating 3D wireframe globe (d3.js)
- ✅ Clean dark theme with neon accents
- ✅ Floating controls (no navbar)
- ✅ Modal-based actions
- ✅ Real-time balance display
- ✅ Chain selector (Base, Arbitrum, Ethereum)

### Backend
- ✅ Stealth address generation (ECDH)
- ✅ Encrypted receipts (AES-256-GCM)
- ✅ Transaction recording
- ✅ Balance aggregation

### Contracts
- ✅ PrivacyRelayer - Private transfers
- ✅ StealthAddressRegistry - Announcement system

---

## Supported Chains (Mainnet)

| Chain | Status | Contracts |
|-------|--------|-----------|
| Base | ✅ Live | Deployed |
| Arbitrum | Ready | Not deployed |
| Ethereum | Ready | Not deployed |

---

## Next Steps

1. Deploy to Arbitrum & Ethereum
2. Integrate UniswapWrapper contract
3. Add ZK proofs (Circom)
4. Mobile responsive improvements
5. Institutional API
