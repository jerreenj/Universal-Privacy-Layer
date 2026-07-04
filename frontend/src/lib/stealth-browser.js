// P3.8 PoC — Browser-side stealth-ownership proof helper.
//
// ⚠ RESEARCH / PoC ONLY ⚠
// See docs/secp256k1-stealth-zk.md.
// This file ships the inputs needed to call /api/zk-stealth/owner and
// (in a future WSL-built deployment) generate a snarkjs Groth16 proof
// against the stealth_owner.circom constraint.
//
// IMPORTANT: do NOT surface this UI in any production channel until:
//   1. The circuit is independently audited.
//   2. The Powers-of-Tau ceremony is replaced with an MPC contribution.
//   3. StealthOwnerVerifier.sol is generated via scripts/zk_stealth_setup.sh
//      AND the deployed address is wired into /api/deployments.
//
// Constraint mirrored from contracts/circuits/stealth_owner.circom:
//   Poseidon(spend_privkey, view_privkey, ephemeral_pubkey_x)
//        = stealth_commitment
//
// Public channels (sent to the server):
//   ephemeral_pubkey_x, stealth_commitment
// Witness (NEVER leaves the device):
//   spend_privkey, view_privkey — BN254 field-element scalars

export async function checkStealthOwnership({
  ephemeral_pubkey_x,
  stealth_commitment,
  witness_hash = null,
  proof_payload = null,
}) {
  // Lazy-load axios so this file is purely declarative.
  const axios = (await import("axios")).default;
  const { API } = await import("@/config/chains");

  const res = await axios.post(`${API}/zk-stealth/owner`, {
    stealth_commitment,
    ephemeral_pubkey_x,
    witness_hash,
    proof_payload,
  });
  // Hard-mirror all three server-side disclaimers in the client response too.
  return {
    ...res.data,
    research_only: true,
    audit_required: true,
    do_not_use_with_real_funds: true,
  };
}

// Stub helper. Real generation requires the snarkjs artifacts to be
// present at /public/zk-stealth/ AND the on-chain verifier deployed.
// Until both are done, callers get a loud error rather than a fake proof.
export async function generateStealthOwnershipProof() {
  throw new Error(
    "Stealth-ownership proof generation is PoC-only. Artifacts require " +
    "WSL build via scripts/zk_stealth_setup.sh AND an external audit. " +
    "See docs/secp256k1-stealth-zk.md."
  );
}
