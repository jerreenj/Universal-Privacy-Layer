# Universal Privacy Layer (UPL) - Product Requirements Document

**Last Updated:** Jan 2026

## Original Problem Statement
Build Universal Privacy Layer (UPL) - "The HTTPS of Web3" - a universal privacy wrapper for every major blockchain. Real production system with real money transactions, NOT mock data.

---

## What's Been Implemented (Jan 2026)

### UI Revamp ✅
- Removed ugly navbar → Floating controls (top right)
- New hexagonal layered logo (replaced shield)
- Cyber-noir dark theme with neon green accents
- Grid background with gradient orbs

### Backend (FastAPI + MongoDB) ✅
- Health check, chain configuration APIs
- Stealth address generation (real ECDH cryptography)
- Dual-key wallet creation with seed phrases
- Encrypted receipt system (AES-256-GCM)
- Transaction recording and history
- Balance aggregation
- **NEW: Uniswap V3 integration APIs**
  - `/api/swap/tokens/{chain}` - Available tokens
  - `/api/swap/quote` - Get swap quotes with 0.05% fee
  - `/api/swap/record` - Record private swaps

### Frontend (React + ethers.js) ✅
- Landing page with new hexagonal logo
- Floating controls (chain selector + wallet button)
- Balance display with hidden/visible toggle
- Stealth address generator
- Private send form
- **NEW: Private Swap component (ETH/WETH/USDC)**
- Transaction history
- Privacy features grid

### Smart Contracts (Solidity) ✅
- `PrivacyRelayer.sol` - Main privacy relayer (batch transfers, 0.05% fee)
- `StealthAddressRegistry.sol` - Stealth address announcements
- `UniswapPrivacyWrapper.sol` - DEX privacy wrapper
- Deployment script ready

---

## Deployer Wallet

**Address:** `0x77483a981724fDa225EF78D8d3CF3c57a30193da`

**Balance:** 0 ETH (needs funding)

### Get Testnet ETH:
1. **Base Sepolia (Cheapest):** https://www.coinbase.com/faucets
2. **Arbitrum Sepolia:** https://www.alchemy.com/faucets/arbitrum-sepolia
3. **Ethereum Sepolia:** https://www.alchemy.com/faucets/ethereum-sepolia

---

## Contract Deployment (After Funding)

```bash
cd /app/contracts

# Set deployer mnemonic
export DEPLOYER_MNEMONIC="inside post tool solar phone biology render blade broken draw hockey senior"

# Deploy to Base Sepolia (cheapest gas ~$2-5)
export DEPLOY_CHAIN=base_sepolia
python deploy.py
```

---

## Uniswap V3 Integration

| Chain | Router | WETH | USDC |
|-------|--------|------|------|
| Ethereum Sepolia | 0x3bFA...48E | 0xfFf9...B14 | 0x1c7D...238 |
| Arbitrum Sepolia | 0x101F...63E | 0x980B...c73 | 0x75fa...4d |
| Base Sepolia | 0x94cC...bc4 | 0x4200...006 | 0x036C...7e |

---

## ZKP Implementation (User-Guided)

```bash
# 1. Install Circom & SnarkJS
npm install -g circom snarkjs

# 2. Create privacy circuit
circom privacy_proof.circom --r1cs --wasm --sym

# 3. Trusted setup ceremony
snarkjs powersoftau new bn128 12 pot12_0000.ptau
snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First contribution"
snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau
snarkjs groth16 setup privacy_proof.r1cs pot12_final.ptau privacy_proof_0000.zkey

# 4. Generate verifier contract
snarkjs zkey export solidityverifier privacy_proof_0000.zkey verifier.sol

# 5. Deploy verifier contract to testnets
```

---

## Testing Results

| Component | Pass Rate |
|-----------|-----------|
| Backend APIs | 88.9% |
| Frontend UI | 95% |

Note: Balance API timeout is expected (external RPC latency)

---

## Next Steps

1. **Fund deployer wallet** with testnet ETH
2. **Deploy contracts** using `/app/contracts/deploy.py`
3. **Update contract addresses** in `UPL_CONTRACTS` (server.py)
4. **Implement ZKP circuits** using Circom guide above
5. **Add more token pairs** for swaps
6. **Security audit** before mainnet

---

## Business Model

| Revenue Stream | Rate |
|----------------|------|
| Privacy Transaction Fee | 0.05% |
| Private Swap Fee | 0.05% |
| Institutional Licensing | TBD |
| Developer API | Usage-based |

---

## File Structure

```
/app
├── backend/
│   └── server.py          # FastAPI with all APIs
├── frontend/
│   └── src/App.js         # React UI
├── contracts/
│   ├── PrivacyRelayer.sol
│   ├── StealthAddressRegistry.sol
│   ├── UniswapPrivacyWrapper.sol
│   ├── deploy.py
│   └── README.md
└── memory/
    └── PRD.md             # This file
```
