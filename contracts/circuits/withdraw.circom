pragma circom 2.2.2;

// ============================================================================
// UPL Privacy Pool — withdrawal proof (Phase 3, Path B)
// ----------------------------------------------------------------------------
// Proves knowledge of (nullifier, secret, merklePath) such that:
//   commitment = Poseidon(nullifier, secret) is a leaf under `root`,
//   and derives nullifierHash = Poseidon(nullifier).
//
// Public signals (the ONLY things revealed):
//   - root            (which Merkle root the deposit is in — a public input)
//   - nullifierHash   (double-spend guard — a public output, computed)
//   - recipient       (where funds go — revealed but unlinkable to any deposit)
//
// Private inputs (witness — never revealed):
//   - nullifier, secret, merklePathElements[20], merklePathIndices[20]
//
// The deposit (commitment) and the withdrawal are cryptographically unlinkable.
// ============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// ----------------------------------------------------------------------------
// MerkleTreeChecker — recompute the root from a leaf + path, assert == root.
// Uses Poseidon(2) per level. merklePathIndices[i] ∈ {0,1} selects whether the
// leaf is the left (0) or right (1) child at level i.
// ----------------------------------------------------------------------------
template MerkleTreeChecker(MERKLE_DEPTH) {
    signal input leaf;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];
    signal input root;

    // Declare loop-scoped signals/components as ARRAYS in the initial scope
    // (circom forbids signal/component declarations inside for loops).
    signal intermediate[MERKLE_DEPTH + 1];
    component hashers[MERKLE_DEPTH];
    signal left[MERKLE_DEPTH];
    signal right[MERKLE_DEPTH];
    signal c[MERKLE_DEPTH];
    signal notC[MERKLE_DEPTH];
    signal curNotC[MERKLE_DEPTH];
    signal sibNotC[MERKLE_DEPTH];
    signal curC[MERKLE_DEPTH];
    signal sibC[MERKLE_DEPTH];

    intermediate[0] <== leaf;

    for (var i = 0; i < MERKLE_DEPTH; i++) {
        // Quadratic switch on the index bit (must be degree-2 to satisfy R1CS).
        // indices[i] is constrained to {0,1} below. Use intermediate products so
        // no constraint exceeds degree 2:
        //   L = current*(1-c) + sibling*c
        //   R = sibling*(1-c) + current*c
        // where c = merklePathIndices[i] ∈ {0,1}.
        c[i] <== merklePathIndices[i];
        notC[i] <== 1 - c[i];
        curNotC[i] <== intermediate[i] * notC[i];    // current * (1-c)
        sibNotC[i] <== merklePathElements[i] * notC[i]; // sibling * (1-c)
        curC[i] <== intermediate[i] * c[i];          // current * c
        sibC[i] <== merklePathElements[i] * c[i];    // sibling * c

        left[i]  <== curNotC[i] + sibC[i];   // current when c=0, sibling when c=1
        right[i] <== sibNotC[i] + curC[i];   // sibling when c=0, current when c=1

        // Constrain the index bit to be exactly 0 or 1 (no other values).
        merklePathIndices[i] * (1 - merklePathIndices[i]) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];

        intermediate[i + 1] <== hashers[i].out;
    }

    // Constrain: the recomputed root MUST equal the claimed public root.
    component rootIsCorrect;
    rootIsCorrect = IsEqual();
    rootIsCorrect.in[0] <== intermediate[MERKLE_DEPTH];
    rootIsCorrect.in[1] <== root;
    rootIsCorrect.out === 1;
}

// ----------------------------------------------------------------------------
// Withdraw — main circuit.
// ----------------------------------------------------------------------------
template Withdraw(MERKLE_DEPTH) {
    // Public inputs (revealed, checked on-chain):
    signal input root;
    signal input recipient;
    signal input nullifier; // made private below — see witness.

    // Private inputs (witness — never revealed):
    signal input secret;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];

    // Public output (computed, returned to verifier):
    signal output nullifierHash;

    // nullifierHash = Poseidon(nullifier) — revealed to block double-spends.
    component nullifierHasher;
    nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;

    // commitment = Poseidon(nullifier, secret) — the leaf stored on-chain.
    component commitmentHasher;
    commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // Prove the commitment is a leaf under the claimed public root.
    component merkle;
    merkle = MerkleTreeChecker(MERKLE_DEPTH);
    merkle.leaf <== commitmentHasher.out;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkle.merklePathElements[i] <== merklePathElements[i];
        merkle.merklePathIndices[i] <== merklePathIndices[i];
    }
    merkle.root <== root;
}

// main: `nullifier` and `secret` and the path are PRIVATE (not in public list).
// `root` and `recipient` are PUBLIC inputs. circom auto-treats all outputs as
// public, so nullifierHash is public by virtue of being an output.
//
// Depth 20 → up to 2^20 = 1,048,576 deposits per pool (matches PrivacyPool.sol).
// To change the depth, update this literal + the Solidity tree depth together.
component main {
    public [root, recipient]
} = Withdraw(20);
