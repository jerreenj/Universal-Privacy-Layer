pragma circom 2.2.2;

// ============================================================================
// UPL Confidential Transfer — variable-amount ZK proof (Phase P2)
// ----------------------------------------------------------------------------
// Proves knowledge of (nullifier, secret, amount, blindingFactor,
// merklePath) such that:
//   1. oldCommitment = Poseidon(nullifier, secret) is a leaf under `root`
//   2. nullifierHash = Poseidon(nullifier) — double-spend guard
//   3. newCommitment = Poseidon(amount, blindingFactor) — new note for recipient
//   4. encryptedAmount = Poseidon(amount, recipient) — recipient can verify
//   5. amount > 0 (range proof via LessThan)
//
// This is the Arcium-style confidential balance layer: the amount is a
// PRIVATE input. The EVM verifies the proof without ever seeing the
// plaintext amount. Between two Privacy Cloak users, zero amount leakage.
//
// Public signals (snarkjs order: outputs first, then public inputs):
//   [nullifierHash, newCommitment, encryptedAmount, root, recipient]
//
// Private inputs (witness — never revealed):
//   nullifier, secret, amount, blindingFactor,
//   merklePathElements[20], merklePathIndices[20]
//
// Depth 20 → up to 2^20 = 1,048,576 notes. Matches the on-chain
// ConfidentialVault.sol MERKLE_DEPTH = 20.
// ============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// ----------------------------------------------------------------------------
// MerkleTreeChecker — recompute the root from a leaf + path, assert == root.
// Identical to the one in withdraw.circom. Poseidon(2) per level.
// ----------------------------------------------------------------------------
template MerkleTreeChecker(MERKLE_DEPTH) {
    signal input leaf;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];
    signal input root;

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
        c[i] <== merklePathIndices[i];
        notC[i] <== 1 - c[i];
        curNotC[i] <== intermediate[i] * notC[i];
        sibNotC[i] <== merklePathElements[i] * notC[i];
        curC[i] <== intermediate[i] * c[i];
        sibC[i] <== merklePathElements[i] * c[i];

        left[i]  <== curNotC[i] + sibC[i];
        right[i] <== sibNotC[i] + curC[i];

        merklePathIndices[i] * (1 - merklePathIndices[i]) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];

        intermediate[i + 1] <== hashers[i].out;
    }

    component rootIsCorrect;
    rootIsCorrect = IsEqual();
    rootIsCorrect.in[0] <== intermediate[MERKLE_DEPTH];
    rootIsCorrect.in[1] <== root;
    rootIsCorrect.out === 1;
}

// ----------------------------------------------------------------------------
// RangeCheck — prove that a signal is > 0 and fits in 64 bits.
// Uses LessThan from comparators.circom. USDC amounts are 6-decimal
// (max ~18.4 * 10^12 USDC with 64-bit range, far beyond any real balance).
// The range proof prevents negative amounts and overflow attacks without
// revealing the actual value.
// ----------------------------------------------------------------------------
template RangeCheck() {
    signal input value;

    // Prove value > 0: value - 1 >= 0 i.e. (value - 1) is non-negative.
    // We check value >= 1 by proving (value - 1) has no borrow in a 64-bit
    // comparison. Simpler: use LessThan to check 0 < value.
    // LessThan(64) returns 1 if in[0] < in[1]. We check 0 < value.
    component isPositive;
    isPositive = LessThan(64);
    isPositive.in[0] <== 0;
    isPositive.in[1] <== value;
    isPositive.out === 1;  // 0 < value must be true

    // Prove value fits in 64 bits: value < 2^64.
    // This prevents overflow in the BN254 field arithmetic.
    signal maxVal;
    maxVal <== 18446744073709551616;  // 2^64
    component isBounded;
    isBounded = LessThan(64);
    isBounded.in[0] <== value;
    isBounded.in[1] <== maxVal;
    isBounded.out === 1;  // value < 2^64 must be true
}

// ----------------------------------------------------------------------------
// ConfidentialTransfer — main circuit.
// ----------------------------------------------------------------------------
template ConfidentialTransfer(MERKLE_DEPTH) {
    // Public inputs (revealed, checked on-chain):
    signal input root;
    signal input recipient;

    // Private inputs (witness — never revealed):
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal input blindingFactor;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];

    // Public outputs (computed, returned to verifier):
    signal output nullifierHash;
    signal output newCommitment;
    signal output encryptedAmount;

    // 1. nullifierHash = Poseidon(nullifier) — double-spend guard.
    component nullifierHasher;
    nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;

    // 2. oldCommitment = Poseidon(nullifier, secret) — the leaf in the tree.
    component commitmentHasher;
    commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // 3. Prove oldCommitment is a leaf under the claimed public root.
    component merkle;
    merkle = MerkleTreeChecker(MERKLE_DEPTH);
    merkle.leaf <== commitmentHasher.out;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkle.merklePathElements[i] <== merklePathElements[i];
        merkle.merklePathIndices[i] <== merklePathIndices[i];
    }
    merkle.root <== root;

    // 4. Range proof: amount > 0 and amount < 2^64.
    //    This prevents zero-amount and negative-amount attacks without
    //    revealing the actual value.
    component rangeCheck;
    rangeCheck = RangeCheck();
    rangeCheck.value <== amount;

    // 5. newCommitment = Poseidon(amount, blindingFactor) — the new note
    //    for the recipient. The recipient learns (amount, blindingFactor)
    //    off-chain and can verify this commitment matches.
    component newCommitmentHasher;
    newCommitmentHasher = Poseidon(2);
    newCommitmentHasher.inputs[0] <== amount;
    newCommitmentHasher.inputs[1] <== blindingFactor;
    newCommitment <== newCommitmentHasher.out;

    // 6. encryptedAmount = Poseidon(amount, recipient) — the recipient
    //    can scan on-chain commitments, compute Poseidon(their_amount,
    //    their_address) for candidate amounts, and check if it matches
    //    this encryptedAmount. This is how the recipient "decrypts" the
    //    amount without it ever being plaintext on-chain.
    component encryptedAmountHasher;
    encryptedAmountHasher = Poseidon(2);
    encryptedAmountHasher.inputs[0] <== amount;
    encryptedAmountHasher.inputs[1] <== recipient;
    encryptedAmount <== encryptedAmountHasher.out;
}

// main: public inputs are [root, recipient]. All other inputs are private.
// Outputs (nullifierHash, newCommitment, encryptedAmount) are auto-public.
//
// snarkjs publicSignals order: [nullifierHash, newCommitment,
// encryptedAmount, root, recipient] — outputs first (declaration order),
// then public inputs (declaration order).
//
// On-chain ConfidentialVault.sol reads:
//   pubSignals[0] = nullifierHash
//   pubSignals[1] = newCommitment
//   pubSignals[2] = encryptedAmount
//   pubSignals[3] = root
//   pubSignals[4] = recipient
//
// Depth 20 → up to 2^20 = 1,048,576 notes (matches ConfidentialVault.sol).
component main {
    public [root, recipient]
} = ConfidentialTransfer(20);
