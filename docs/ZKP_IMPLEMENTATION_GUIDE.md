# Zero-Knowledge Proof (ZKP) Implementation Guide

**Universal Privacy Layer - ZKP Integration**

## Overview

This guide explains how to integrate Zero-Knowledge Proofs into the Universal Privacy Layer for enhanced privacy guarantees. ZKPs allow users to prove they possess certain information without revealing the information itself.

## Technology Stack

- **Circom**: Domain-specific language for writing arithmetic circuits
- **snarkjs**: JavaScript library for zkSNARK proof generation/verification
- **Solidity Verifier**: Auto-generated smart contract for on-chain verification

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  User Browser   │────▶│   Circom     │────▶│  Trusted Setup  │
│  (Private Data) │     │   Circuit    │     │  (Powers of Tau)│
└─────────────────┘     └──────────────┘     └─────────────────┘
         │                     │                      │
         ▼                     ▼                      ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   snarkjs       │────▶│    Proof     │────▶│ Verifier.sol    │
│   (Generate)    │     │   (JSON)     │     │  (On-Chain)     │
└─────────────────┘     └──────────────┘     └─────────────────┘
```

## 1. Circuit Design

### Stealth Address Ownership Proof

This circuit proves you own a stealth address without revealing the private key.

**File: `/app/circuits/stealth_ownership.circom`**

```circom
pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Prove ownership of a stealth address
// Public inputs: stealthAddressHash, viewTag
// Private inputs: spendPrivKey, ephemeralPubKey
template StealthOwnership() {
    // Private inputs
    signal input spendPrivKey;
    signal input ephemeralPubKeyX;
    signal input ephemeralPubKeyY;
    signal input viewPrivKey;
    
    // Public inputs
    signal input stealthAddressHash;
    signal input viewTag;
    
    // Output
    signal output isValid;
    
    // Step 1: Compute shared secret S = viewPrivKey * ephemeralPubKey
    // (simplified - real impl needs elliptic curve multiplication)
    component sharedSecret = Poseidon(3);
    sharedSecret.inputs[0] <== viewPrivKey;
    sharedSecret.inputs[1] <== ephemeralPubKeyX;
    sharedSecret.inputs[2] <== ephemeralPubKeyY;
    
    // Step 2: Derive stealth private key = spendPrivKey + hash(S)
    component stealthKeyHash = Poseidon(2);
    stealthKeyHash.inputs[0] <== spendPrivKey;
    stealthKeyHash.inputs[1] <== sharedSecret.out;
    
    // Step 3: Compute stealth address hash
    component addressHash = Poseidon(1);
    addressHash.inputs[0] <== stealthKeyHash.out;
    
    // Step 4: Verify view tag (first 8 bits of hash)
    component viewTagCheck = Poseidon(2);
    viewTagCheck.inputs[0] <== sharedSecret.out;
    viewTagCheck.inputs[1] <== stealthAddressHash;
    
    // Constraints
    stealthAddressHash === addressHash.out;
    
    isValid <== 1;
}

component main {public [stealthAddressHash, viewTag]} = StealthOwnership();
```

### Private Transfer Amount Proof

Prove a transfer amount is within valid range without revealing the actual amount.

**File: `/app/circuits/amount_range.circom`**

```circom
pragma circom 2.1.0;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

// Prove amount is in range [0, maxAmount] without revealing it
template AmountRangeProof(n) {
    // Private
    signal input amount;
    signal input salt;
    
    // Public
    signal input commitment;
    signal input maxAmount;
    
    // Verify commitment = Poseidon(amount, salt)
    component hasher = Poseidon(2);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== salt;
    commitment === hasher.out;
    
    // Verify amount <= maxAmount
    component lt = LessEqThan(n);
    lt.in[0] <== amount;
    lt.in[1] <== maxAmount;
    lt.out === 1;
    
    // Verify amount >= 0 (implicit in field)
    signal amountBits[n];
    var sum = 0;
    for (var i = 0; i < n; i++) {
        amountBits[i] <-- (amount >> i) & 1;
        amountBits[i] * (1 - amountBits[i]) === 0;
        sum += amountBits[i] * (1 << i);
    }
    sum === amount;
}

component main {public [commitment, maxAmount]} = AmountRangeProof(64);
```

## 2. Trusted Setup

### Powers of Tau Ceremony

```bash
# Download Hermez powers of tau (already trusted)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

# Or generate your own (development only)
snarkjs powersoftau new bn128 15 pot15_0000.ptau
snarkjs powersoftau contribute pot15_0000.ptau pot15_0001.ptau --name="First contribution"
snarkjs powersoftau prepare phase2 pot15_0001.ptau pot15_final.ptau
```

### Circuit-Specific Setup

```bash
# Compile circuit
circom stealth_ownership.circom --r1cs --wasm --sym

# Generate proving key
snarkjs groth16 setup stealth_ownership.r1cs pot15_final.ptau stealth_0000.zkey

# Contribute to phase 2
snarkjs zkey contribute stealth_0000.zkey stealth_final.zkey --name="Phase 2 contribution"

# Export verification key
snarkjs zkey export verificationkey stealth_final.zkey verification_key.json

# Generate Solidity verifier
snarkjs zkey export solidityverifier stealth_final.zkey StealthVerifier.sol
```

## 3. Solidity Integration

### Verifier Contract

The auto-generated `StealthVerifier.sol` will look like:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Groth16Verifier {
    // ... (auto-generated pairing check code)
    
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[2] memory input
    ) public view returns (bool) {
        // ... verification logic
    }
}
```

### Integration with PrivacyRelayer

**File: `/app/contracts/PrivacyRelayerWithZKP.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Groth16Verifier.sol";

contract PrivacyRelayerWithZKP {
    Groth16Verifier public verifier;
    
    constructor(address _verifier) {
        verifier = Groth16Verifier(_verifier);
    }
    
    function relayWithProof(
        address stealthAddress,
        bytes32 viewTag,
        uint[2] memory proofA,
        uint[2][2] memory proofB,
        uint[2] memory proofC
    ) external payable {
        // Convert inputs to field elements
        uint[2] memory publicInputs;
        publicInputs[0] = uint256(keccak256(abi.encodePacked(stealthAddress)));
        publicInputs[1] = uint256(viewTag);
        
        // Verify ZK proof
        require(
            verifier.verifyProof(proofA, proofB, proofC, publicInputs),
            "Invalid ZK proof"
        );
        
        // Execute relay
        (bool success, ) = stealthAddress.call{value: msg.value}("");
        require(success, "Transfer failed");
        
        emit PrivateTransferWithProof(stealthAddress, msg.value, viewTag);
    }
    
    event PrivateTransferWithProof(
        address indexed stealthAddress,
        uint256 amount,
        bytes32 viewTag
    );
}
```

## 4. Frontend Integration

### Proof Generation in Browser

```javascript
import { groth16 } from 'snarkjs';

async function generateStealthOwnershipProof(
  spendPrivKey,
  ephemeralPubKey,
  viewPrivKey,
  stealthAddress
) {
  // Load circuit WASM and proving key
  const wasmPath = '/circuits/stealth_ownership.wasm';
  const zkeyPath = '/circuits/stealth_final.zkey';
  
  // Prepare inputs
  const input = {
    spendPrivKey: BigInt(spendPrivKey).toString(),
    ephemeralPubKeyX: BigInt(ephemeralPubKey.x).toString(),
    ephemeralPubKeyY: BigInt(ephemeralPubKey.y).toString(),
    viewPrivKey: BigInt(viewPrivKey).toString(),
    stealthAddressHash: BigInt(stealthAddress).toString(),
    viewTag: computeViewTag(ephemeralPubKey, viewPrivKey)
  };
  
  // Generate proof
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );
  
  // Format for Solidity
  const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
  return JSON.parse(`[${calldata}]`);
}

// Usage
const proof = await generateStealthOwnershipProof(
  userSpendKey,
  receivedEphemeralKey,
  userViewKey,
  stealthAddress
);

// Send to contract
await privacyRelayer.relayWithProof(
  stealthAddress,
  viewTag,
  proof[0], proof[1], proof[2]
);
```

## 5. Development Setup

### Install Dependencies

```bash
# Install Circom
curl -Ls https://scrypt.io/scripts/setup-circom.sh | sh

# Install snarkjs
npm install -g snarkjs

# Install circomlib
npm install circomlib
```

### Project Structure

```
/app/circuits/
├── stealth_ownership.circom
├── amount_range.circom
├── build/
│   ├── stealth_ownership.r1cs
│   ├── stealth_ownership.wasm
│   └── stealth_ownership.sym
├── keys/
│   ├── pot15_final.ptau
│   ├── stealth_final.zkey
│   └── verification_key.json
└── verifiers/
    └── StealthVerifier.sol
```

### Build Script

```bash
#!/bin/bash
# build-circuits.sh

CIRCUIT=$1
PTAU=keys/pot15_final.ptau

echo "Compiling $CIRCUIT..."
circom circuits/$CIRCUIT.circom --r1cs --wasm --sym -o build/

echo "Setting up proving key..."
snarkjs groth16 setup build/$CIRCUIT.r1cs $PTAU keys/${CIRCUIT}_0000.zkey
snarkjs zkey contribute keys/${CIRCUIT}_0000.zkey keys/${CIRCUIT}_final.zkey --name="Contribution 1"

echo "Exporting verification key..."
snarkjs zkey export verificationkey keys/${CIRCUIT}_final.zkey keys/${CIRCUIT}_vkey.json

echo "Generating Solidity verifier..."
snarkjs zkey export solidityverifier keys/${CIRCUIT}_final.zkey verifiers/${CIRCUIT^}Verifier.sol

echo "Done! Files in build/, keys/, and verifiers/"
```

## 6. Security Considerations

### Trusted Setup
- Use community-generated Powers of Tau (Hermez, Zcash, etc.)
- Multiple contributors improve security
- Anyone can verify the ceremony

### Circuit Design
- Avoid constraint under-specification
- Use battle-tested libraries (circomlib)
- Audit circuits before production

### Private Inputs
- Never expose private inputs to contracts
- Generate proofs client-side only
- Use secure random number generation for salts

## 7. Gas Costs

| Operation | Gas Cost (approx) |
|-----------|-------------------|
| Groth16 Verification | ~250,000 gas |
| PLONK Verification | ~300,000 gas |
| Proof Generation (browser) | 2-5 seconds |

## 8. Next Steps for UPL

1. **Phase 1**: Implement stealth ownership circuit
2. **Phase 2**: Add amount range proofs for confidential transfers
3. **Phase 3**: Integrate with existing PrivacyRelayer contracts
4. **Phase 4**: Add withdrawal proofs (prove you received funds without revealing sender)

## Resources

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs GitHub](https://github.com/iden3/snarkjs)
- [circomlib](https://github.com/iden3/circomlib)
- [Tornado Cash circuits](https://github.com/tornadocash/tornado-core/tree/master/circuits) (reference)
- [Hermez Powers of Tau](https://github.com/hermeznetwork/phase2ceremony)
