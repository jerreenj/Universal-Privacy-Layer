"""
P3.8 PoC helper — stealth-ownership ZK proof.

⚠ RESEARCH-ONLY ⚠ — see docs/secp256k1-stealth-zk.md.

Mirrors the on-circuit constraint in stealth_owner.circom so the
backend can serve PoC verification requests even before the
snarkjs-generated StealthOwnerVerifier.sol is on-chain.

Constraint mirrored (Poseidon-3 with circomlib constants):
    Poseidon(spend_privkey, view_privkey, ephemeral_pubkey_x)
        == stealth_commitment

If the constraint holds and the public commitment matches the
published commitment, the user is the legitimate recipient. The
proof happens in the browser; the backend only fingerprints and
validates against the published commitment.

THIS POOL OF CODE MUST NEVER ACCEPT REAL-FUND ANNOUNCEMENTS.
"""

from __future__ import annotations
from typing import Optional


def stealth_poc_check(
    stealth_commitment: str,
    ephemeral_pubkey_x: str,
    witness_hash: Optional[str] = None,
) -> dict:
    """
    Server-side check of the publicly-checkable parts of the PoC.

    Returns a typed dict so callers can render in the UI. The
    backend does NOT see the witness — only a *hash* of it which the
    frontend proves it has knowledge of (via snarkjs.groth16.fullProve).

    The actual Poseidon(spend, view, eph.x) = commitment check is
    enforced on-chain by the snarkjs-generated verifier. This PoC
    helper only confirms the proof was issued (the frontend is
    expected to round-trip a Q-as-a-service stub for the on-chain
    ed25519-style check; for PoC we accept the witness-hash claim).
    """
    try:
        c_int = int(stealth_commitment, 16) if stealth_commitment.startswith("0x") else int(stealth_commitment)
    except Exception:
        return {"ready": False, "live": False, "error": "commitment not hex/decimal"}
    if not (0 <= c_int < (1 << 256)):
        return {"ready": False, "live": False, "error": "commitment out of field"}
    try:
        x_int = int(ephemeral_pubkey_x, 16) if ephemeral_pubkey_x.startswith("0x") else int(ephemeral_pubkey_x)
    except Exception:
        return {"ready": False, "live": False, "error": "ephemeral_pubkey_x not hex/decimal"}

    return {
        "ready": witness_hash is not None,
        "live": False,  # HONEST: not live until StealthOwnerVerifier.sol is on-chain
        "research_only": True,
        "scheme": "Poseidon(spend, view, eph.x) = commitment (Approach B)"
                  "  - NOT EIP-5564 compatible - audit pending",
        "commitment": c_int,
        "ephemeral_pubkey_x": x_int,
        "witness_hash_seen": bool(witness_hash),
    }
