# UPL ZKP Circuits

Zero-Knowledge Proof circuits for Universal Privacy Layer.

## Circuits

| Circuit | Purpose | Public Inputs |
|---------|---------|---------------|
| `stealth_ownership` | Prove ownership of stealth address | stealthAddressHash, nullifier |
| `amount_range` | Prove amount is in valid range | commitment, maxAmount |
| `membership` | Prove Merkle tree membership | root, nullifierHash |

## Automatic Compilation (GitHub Actions)

Circuits are automatically compiled when you push changes to `circuits/sources/`.

### How It Works:
1. Push changes to the repo
2. GitHub Actions workflow triggers automatically
3. Circuits compiled on GitHub's x86 servers
4. Download artifacts from the workflow run

### Artifacts Generated:
- **WASM files** - For browser-based proof generation
- **Proving keys** (.zkey) - For generating proofs
- **Verification keys** (.json) - For verifying proofs
- **Solidity verifiers** (.sol) - For on-chain verification

## Manual Compilation

If you want to compile locally:

```bash
# Prerequisites
npm install -g circom snarkjs
npm install  # Install circomlib

# Compile all circuits
./build_circuits.sh

# Or compile individually
circom sources/stealth_ownership.circom --r1cs --wasm --sym -o build -l node_modules
```

## Using in Frontend

After compilation, copy WASM files to frontend:

```bash
cp build/*_js/*.wasm ../frontend/public/circuits/
```

Then in your frontend code:

```javascript
import { groth16 } from 'snarkjs';

async function generateProof(inputs) {
  const wasmPath = '/circuits/stealth_ownership.wasm';
  const zkeyPath = '/circuits/stealth_ownership_final.zkey';
  
  const { proof, publicSignals } = await groth16.fullProve(
    inputs,
    wasmPath,
    zkeyPath
  );
  
  return { proof, publicSignals };
}
```

## On-Chain Verification

Verifier contracts are already deployed on all 7 chains:

| Chain | Verifier Address |
|-------|------------------|
| Base | `0x98940B431d829832d2Ad5eB0812824A3C40D1bF1` |
| Arbitrum | `0xbdFc25A62dcCFbc710072Ae2EaE5c3a57674bDad` |
| Polygon | `0xD04f9cE68CfF7C0FD6d631794964784B99423943` |
| Optimism | `0xD04f9cE68CfF7C0FD6d631794964784B99423943` |
| BNB | `0xD04f9cE68CfF7C0FD6d631794964784B99423943` |
| Avalanche | `0xD04f9cE68CfF7C0FD6d631794964784B99423943` |
| Hyperliquid | `0xD04f9cE68CfF7C0FD6d631794964784B99423943` |

## File Structure

```
circuits/
├── sources/                  # Circom source files
│   ├── stealth_ownership.circom
│   ├── amount_range.circom
│   └── membership.circom
├── build/                    # Compiled output (generated)
│   ├── *.r1cs
│   └── *_js/*.wasm
├── keys/                     # Proving/verification keys (generated)
│   ├── *_final.zkey
│   └── *_vkey.json
├── verifiers/                # Solidity verifiers (generated)
│   └── *Verifier.sol
├── build_circuits.sh         # Local build script
├── package.json
└── README.md
```

## Security Notes

- The Powers of Tau used is from the Hermez ceremony (trusted)
- For production, run your own Phase 2 contribution
- Nullifiers prevent double-spending of proofs
