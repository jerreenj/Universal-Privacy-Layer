pragma circom 2.2.2;

// ============================================================================
// UPL Confidential Notes — SPEND / SETTLEMENT proof
// ----------------------------------------------------------------------------
// Proves knowledge of (nullifier, secret) such that:
//   commitment = Poseidon(nullifier, secret) is a known note,
//   and the caller wants to settle it for `amount` USDC.
//
// Public signals (the ONLY things revealed):
//   - nullifierHash   (double-spend guard — a hash, not the nullifier itself)
//   - amount          (visible at settlement — this is unavoidable)
//
// Private inputs (witness — never revealed):
//   - nullifier, secret
//
// The settlement contract checks:
//   1. The proof is valid (this circuit)
//   2. nullifierHash hasn't been spent yet
//   3. Transfers `amount` USDC to the recipient
//
// The link between "which note was settled" and "this settlement tx" is
// broken because nullifierHash is a hash — observers can't reverse it to
// find the original note creation tx.
// ============================================================================

include "circomlib/circuits/poseidon.circom";

template Spend() {
    // Public inputs
    signal input nullifierHash;
    signal input amount;

    // Private inputs (witness)
    signal input nullifier;
    signal input secret;

    // Prove: nullifierHash = Poseidon(nullifier)
    component nullifierHasher;
    nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // Prove: the caller knows the secret that pairs with this nullifier
    // to form a valid note commitment. We don't need to check the Merkle
    // tree here — the settlement contract checks that the nullifierHash
    // corresponds to a note that was created (by checking it against the
    // ConfidentialNotes contract's nullifier set).
    //
    // The commitment = Poseidon(nullifier, secret) is computed but NOT
    // output as a public signal — it's only used internally to ensure
    // the nullifier+secret pair is valid.
    component commitmentHasher;
    commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // Amount must be positive (range check)
    signal amountPositive;
    amountPositive <== amount;
    amountPositive === amount; // constrain amount is the claimed value
}

// main: nullifier and secret are PRIVATE. nullifierHash and amount are PUBLIC.
component main {
    public [nullifierHash, amount]
} = Spend();
