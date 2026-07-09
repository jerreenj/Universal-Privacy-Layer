pragma circom 2.2.2;

// ============================================================================
// UPL Confidential Notes — zero-leak amount hiding on Base (P2 v2)
// ----------------------------------------------------------------------------
// Proves knowledge of (nullifier, secret, amount, blindingFactor,
// recipientViewKey, merklePath) such that:
//   1. oldCommitment = Poseidon(nullifier, secret) is a leaf under `root`
//   2. nullifierHash = Poseidon(nullifier) — double-spend guard
//   3. newCommitment = Poseidon(amount, blindingFactor, recipientViewKey)
//      — the new note for the recipient. Only someone who knows the
//      recipientViewKey can identify this as theirs.
//   4. encryptedAmount = Poseidon(amount, recipientViewKey) — the recipient
//      computes Poseidon(their_amount, their_view_key) off-chain and checks
//      if it matches this value. If it does, the note is theirs and they
//      know the amount. No address is ever revealed on-chain.
//   5. amount > 0 and amount < 2^64 (range proof)
//
// CRITICAL DIFFERENCE FROM THE PREVIOUS CIRCUIT:
//   `recipientViewKey` is a PRIVATE input. The previous circuit leaked it
//   as a public input. Now NOTHING about the recipient is on-chain.
//
// Public signals (snarkjs order: outputs first, then public inputs):
//   [nullifierHash, newCommitment, encryptedAmount, root]
//
// Private inputs (witness — never revealed):
//   nullifier, secret, amount, blindingFactor, recipientViewKey,
//   merklePathElements[20], merklePathIndices[20]
//
// Depth 20 → up to 2^20 = 1,048,576 notes.
// ============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// ----------------------------------------------------------------------------
// MerkleTreeChecker — identical to withdraw.circom + confidential_transfer
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

        left[i] <== curNotC[i] + sibC[i];
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
// RangeCheck — prove amount > 0 and fits in 64 bits
// ----------------------------------------------------------------------------
template RangeCheck() {
    signal input value;

    component isPositive;
    isPositive = LessThan(64);
    isPositive.in[0] <== 0;
    isPositive.in[1] <== value;
    isPositive.out === 1;

    signal maxVal;
    maxVal <== 18446744073709551616; // 2^64
    component isBounded;
    isBounded = LessThan(64);
    isBounded.in[0] <== value;
    isBounded.in[1] <== maxVal;
    isBounded.out === 1;
}

// ----------------------------------------------------------------------------
// ConfidentialNotes — main circuit (recipientViewKey is PRIVATE)
// ----------------------------------------------------------------------------
template ConfidentialNotes(MERKLE_DEPTH) {
    // Public inputs (only root — NO recipient):
    signal input root;

    // Private inputs (ALL witness — never revealed):
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal input blindingFactor;
    signal input recipientViewKey;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];

    // Public outputs (computed — all hashes, no plaintext):
    signal output nullifierHash;
    signal output newCommitment;
    signal output encryptedAmount;

    // 1. nullifierHash = Poseidon(nullifier) — double-spend guard.
    component nullifierHasher;
    nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;

    // 2. oldCommitment = Poseidon(nullifier, secret) — the Merkle leaf.
    component commitmentHasher;
    commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // 3. Merkle inclusion proof.
    component merkle;
    merkle = MerkleTreeChecker(MERKLE_DEPTH);
    merkle.leaf <== commitmentHasher.out;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkle.merklePathElements[i] <== merklePathElements[i];
        merkle.merklePathIndices[i] <== merklePathIndices[i];
    }
    merkle.root <== root;

    // 4. Range proof: amount > 0 and amount < 2^64.
    component rangeCheck;
    rangeCheck = RangeCheck();
    rangeCheck.value <== amount;

    // 5. newCommitment = Poseidon(amount, blindingFactor, recipientViewKey)
    //    — a 3-input Poseidon. Binds the note to the recipient without
    //    revealing them. Only someone who knows recipientViewKey can
    //    identify this note as theirs.
    component newCommitmentHasher;
    newCommitmentHasher = Poseidon(3);
    newCommitmentHasher.inputs[0] <== amount;
    newCommitmentHasher.inputs[1] <== blindingFactor;
    newCommitmentHasher.inputs[2] <== recipientViewKey;
    newCommitment <== newCommitmentHasher.out;

    // 6. encryptedAmount = Poseidon(amount, recipientViewKey)
    //    — the recipient computes Poseidon(their_amount, their_view_key)
    //    off-chain and checks if it matches this on-chain value. If yes,
    //    the note is theirs and they know the amount. The recipientViewKey
    //    NEVER appears on-chain — it's a private witness input.
    component encryptedAmountHasher;
    encryptedAmountHasher = Poseidon(2);
    encryptedAmountHasher.inputs[0] <== amount;
    encryptedAmountHasher.inputs[1] <== recipientViewKey;
    encryptedAmount <== encryptedAmountHasher.out;
}

// main: ONLY root is public. Everything else is private.
// snarkjs publicSignals order: [nullifierHash, newCommitment,
// encryptedAmount, root] — outputs first (declaration order),
// then public inputs.
//
// On-chain ConfidentialNotes.sol reads:
//   pubSignals[0] = nullifierHash
//   pubSignals[1] = newCommitment
//   pubSignals[2] = encryptedAmount
//   pubSignals[3] = root
//
// NO recipient address. NO amount. NO identity. Only hashes.
component main {
    public [root]
} = ConfidentialNotes(20);
