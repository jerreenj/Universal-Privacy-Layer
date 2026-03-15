# Universal Privacy Layer (UPL) - PRD

**Last Updated:** March 15, 2026

## OVERVIEW
Universal Privacy Layer provides private transactions across 7 EVM chains with ZKP verification, stealth addresses, and cross-chain privacy splitting.

## DEPLOYED CONTRACTS

### Privacy Relayer (All 7 Chains)
```
Address: 0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c
```

### Stealth Registry (All 7 Chains)
```
Address: 0xf2E7A6734E58774A8417c176AaE3898667699Ff4
```

### ZKP Verifier Contracts (Newly Deployed)
| Chain | Address |
|-------|---------|
| Base | 0x98940B431d829832d2Ad5eB0812824A3C40D1bF1 |
| Arbitrum | 0xbdFc25A62dcCFbc710072Ae2EaE5c3a57674bDad |
| Polygon | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Optimism | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| BNB Chain | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Avalanche | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |
| Hyperliquid | 0xD04f9cE68CfF7C0FD6d631794964784B99423943 |

## IMPLEMENTED FEATURES (100%)

### Core Features
- ✅ Private Receive (Stealth Addresses)
- ✅ Private Send
- ✅ Private Swap
- ✅ Hidden Wallet Balance (Aggregated)
- ✅ Dual Seed Phrase System
- ✅ Transaction History

### Advanced Features  
- ✅ **ZKP Proofs** - On-chain verification via deployed UPLVerifier contracts
- ✅ **On-Chain Relayer** - Route through PrivacyRelayer contract
- ✅ **Cross-Chain Split** - Split payments across multiple chains
- ✅ **Encrypted Messaging** - E2E encrypted messages
- ✅ **Multisig Privacy** - Off-chain signature collection

### Extra Tools
- ✅ NFT Privacy Proxy
- ✅ Token Approval Privacy
- ✅ Contract Privacy Proxy
- ✅ Chain Status Dashboard

## ZKP CIRCUITS

Located at `/app/circuits/sources/`:
- `stealth_ownership.circom` - Prove stealth address ownership
- `amount_range.circom` - Prove amount is in valid range
- `membership.circom` - Prove Merkle tree membership

### Build Instructions
```bash
# On local machine (x86_64)
cd /app/circuits
./build_circuits.sh
```

This generates:
- R1CS constraint files
- WASM for browser proof generation
- Proving/Verification keys
- Solidity verifier contracts

## API ENDPOINTS

### ZKP
- `POST /api/zkp/generate-inputs` - Generate circuit inputs
- `POST /api/zkp/submit-proof` - Submit proof
- `POST /api/zkp/verify-onchain` - Verify via on-chain contract
- `GET /api/zkp/verifier-info/{chain}` - Get verifier contract info

### Relayer
- `POST /api/relayer/prepare-tx` - Prepare relayer transaction
- `GET /api/relayer/stats/{chain}` - Get relayer stats

### Cross-Chain
- `POST /api/split/prepare` - Create split plan
- `GET /api/split/{split_id}` - Get split status

### Messaging
- `POST /api/messaging/send` - Send encrypted message
- `GET /api/messaging/inbox/{address}` - Get inbox

### Multisig
- `POST /api/multisig/create` - Create multisig
- `POST /api/multisig/propose` - Create proposal
- `POST /api/multisig/sign` - Sign proposal

## KEY FILES
- `/app/frontend/src/App.js` - React frontend
- `/app/backend/server.py` - FastAPI backend
- `/app/contracts/UPLVerifier.sol` - ZKP verifier contract
- `/app/circuits/` - Circom ZKP circuits
- `/app/circuits/build_circuits.sh` - Build script

## TESTING
- Backend: 27/27 tests passed
- Frontend: All features verified
- Report: `/app/test_reports/iteration_5.json`
