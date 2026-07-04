pragma circom 2.2.2;

// ============================================================================
// UPL secp256k1 Stealth-Address Ownership Proof (P3.8 PoC)
// ----------------------------------------------------------------------------
// ⚠ RESEARCH-ONLY — DO NOT DEPLOY WITH REAL FUNDS UNTIL EXTERNAL AUDIT. ⚠
//
// See docs/secp256k1-stealth-zk.md for the full threat model and the audit
// checklist. This circuit is the Poseidon-based KDF PoC (Approach B in the
// research doc) — it is NOT an EIP-5564 compatible stealth-address scheme.
//
// What this proof demonstrates:
//   "I know (spend_privkey, view_privkey) such that
//    Poseidon(spend_privkey, view_privkey, ephemeral_pubkey_x)
//    equals the published stealth_commitment.
//
// Why that's useful:
//   The recipient can prove ownership without revealing either of their
//   private keys. The verifier checks the public commitment and the
//   ephemeral key on-chain; the prover's keypair never crosses the
//   ring — so the linkability leak that today clusters every stealth
//   address under one spend_pubkey can be broken by an upgraded flow.
//
// Constraint budget (target): ~200–500 R1CS rows. Proving time target: <3 s
// in a browser. Verifier gas: ~200k gas (this circuit's verifier is exposed
// in src/StealthOwnerVerifier.sol — which is a PoC and must be audited).
//
// Upgrade path to full EIP-5564 mode: see the research doc, section 8.
// ============================================================================

include "circomlib/circuits/poseidon.circom";

// ----------------------------------------------------------------------------
// The "approach B" PoC:
//   prove knowledge of (spend, view) s.t. Poseidon(spend, view, eph.x) = commit
//
// A witness is `(/pubkey.x, spend_privkey, view_privkey)`. No witness is
// emitted unless the constraint holds (soundness comes from the same
// argument as the privacy-pool circuit).
// ----------------------------------------------------------------------------
template StealthOwner() {
    // Public inputs — the verifier sees these on-chain.
    signal input ephemeral_pubkey_x;
    signal input stealth_commitment;

    // Private inputs — the witness, never revealed.
    signal input spend_privkey;
    signal input view_privkey;

    // By the same constant-extraction argument as PoseidonT3.sol:
    // the in-circuit Poseidon(3) MUST equal the on-chain Poseidon(3) (with the
    // same circomlib constants) — otherwise the proof verifies against a
    // commitment the recipient did not actually generate.
    component h = Poseidon(3);
    h.inputs[0] <== spend_privkey;
    h.inputs[1] <== view_privkey;
    h.inputs[2] <== ephemeral_pubkey_x;

    h.out === stealth_commitment;
}

// Public signals (snarkjs order):
//   [0] = ephemeral_pubkey_x
//   [1] = stealth_commitment
// Both are public; spend_privkey and view_privkey are witness-only.
component main {
    public [ephemeral_pubkey_x, stealth_commitment]
} = StealthOwner();
