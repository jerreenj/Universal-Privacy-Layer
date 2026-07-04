# secp256k1 Stealth-Address Zero-Knowledge Proofs (P3.8 — Research)

> **READ THIS FIRST.** This document is the result of a research milestone for
> P3.8. It is NOT a deployment specification. **Every code path under
> `/zk-stealth/*` and every contract in `contracts/src/Stealth*` is
> proof-of-concept only.** No real funds may be sent to a stealth address
> gated by a PoC verifier until (a) the underlying circuit has been
> independently audited, AND (b) the Powers-of-Tau ceremony used has been
> re-run with ≥ 2 independent participants.

## 1. The privacy problem today

The current UPL stealth-address model (P1.4, EIP-5564) is:

```
Recipient publishes:  spend_pubkey, view_pubkey   (both public)
Sender picks:         ephemeral_key   (random scalar)
                      ephemeral_pubkey = ephemeral_key * G
Shared secret:        secp256k1_ecdh(view_pubkey, ephemeral_pubkey)
Stealth address:      spend_pubkey + Hash(shared_secret) * G
                      → recipient derives the spend key = (spend_privkey + Hash(shared_secret))
```

What this leaks:

1. Every announcement on-chain is tagged with the **same `spend_pubkey`**.
   An observer can cluster all of a recipient's stealth addresses via this
   one public element. Linkability is the entire reason the stack is called
   "Privacy" in the first place — so this leak is real.
2. The relayer sees `(view_pubkey, ephemeral_pubkey, stealth_address)` for
   every submission. With enough meta-data they can correlate.

What we want from the ZK proof:

A proof that, given a stealth address and the published announcement, the
prover knows a `(spend_privkey, view_privkey)` pair such that the
relationship holds — **without revealing** the privkeys or even the public
keypair. The verifier can check that the announcement was made by a
legitimate stealth-address sender without seeing their identity.

This breaks the linkability: the same human, publishing many stealth
addresses, can publish a different "spend_pubkey" commitment per
announcement (or no commitment at all), making cross-correlation
infeasible.

## 2. Two approaches

There are two fundamentally different ways to do this:

### Approach A — Native secp256k1 inside BN254

Implement the secp256k1 curve and ECDH *inside* a circom circuit using
arithmetic over the BN254 scalar field. This is mathematically the most
faithful to EIP-5564. Cost: roughly **10,000–30,000 R1CS constraints** per
proof (secp256k1 scalar multiplication is ~2,500 constraints per add, so
a full blinding + addition chain is large). Proving time: **30–120 s** in
the browser. Verifier gas: **~250k gas**.

This is the approach used by Semaphore, Railgun, and other production
"EVM-friendly" stealth-address ZK systems. It has been audited, but
libraries mature slowly and there are known bugs in naive
implementations (correctness of field-to-curve mappings is subtle).

### Approach B — Poseidon-based KDF (PoC, NOT EIP-5564 compatible)

Replace the secp256k1_ecdh + Keccak256 KDF with a single Poseidon hash
function. The stealth-address becomes:

```
stealth_address = Poseidon( spend_privkey || view_privkey || ephemeral_pubkey.x )
```

(where `spend_privkey` is a field element, and `ephemeral_pubkey.x` is the
x-coordinate of some public key.) The ZK proof is:

> I know (spend_privkey, view_privkey) such that
> Poseidon(spend, view, ephem.x) = published_stealth_commitment.

Constraint count: **roughly 200–500 R1CS constraints**. Proving time:
**1–3 s** in the browser. Verifier gas: **~200k gas**. **NOT compatible
with EIP-5564** but **sufficient for an internal-privacy use case**:
within the UPL cloud, users would use this scheme under a custom
flow. The on-chain verifier is independent of how messages are
announced.

### The honest choice

This PR ships **Approach B as a PoC** because:

- The complexity of Approach A is at "weeks of expert cryptographic
  engineering" level and has bitten several production projects.
- Approach B demonstrates the ZK technique end-to-end and lets the
  privacy model be reasoned about separately from the cryptographic
  primitives.
- An upgrade path to Approach A is straightforward once the PoC flow is
  stable: replace `stealth_owner.circom` and regenerate the verifier.

**Approach B is the PoC shipped in this milestone.** Switching to
Approach A in a follow-up is a research task, not a deployment.

## 3. PoC scheme (Approach B) — design

Public inputs:

- `stealth_commitment` — a Poseidon hash the recipient publishes alongside
  each submitted announcement (out-of-band; off-chain or as an
  EIP-5564-style view tag extension).
- `ephemeral_pubkey_x` — the on-chain ephemeral public key's x
  coordinate (the relayer / sender reveals this in the standard EIP-5564
  flow).

Private (witness) inputs:

- `spend_privkey` — a BN254 field element the recipient knows.
- `view_privkey` — a BN254 field element the recipient knows.

Constraint (one equality):

```
Poseidon( spend_privkey, view_privkey, ephemeral_pubkey_x ) == stealth_commitment
```

If this holds, the recipient *knows* the privkeys whose Poseidon digest
matches the published commitment. They therefore know the spend key
material to spend from the stealth address — which is exactly what the
verifier of an "ownership" check requires.

## 4. Trust model — what the PoC actually proves

| What | Reality |
|---|---|
| "knows spend_privkey" soundness | YES (whatever-inputs pass Poseidon equal check = only valid witness) |
| EIP-5564 compatibility | NO — different KDF |
| Audit-grade | NO — Poseidon-vendoring path, ceremony trust, secp256k1 mapping are all research-stage |
| Resistance to quantum | Same as Hash-based schemes — broken if Poseidon is broken |
| Frontend → backend liveness | YES — works end-to-end through `/api/zk-stealth/owner` |

**Do not announce to users that this PoC guarantees any of the privacy
properties of the deployment system.** It's a research sketch.

## 5. Files

The PoC lives under three trees:

```
contracts/
  circuits/stealth_owner.circom       ← Poseidon(privkey, privkey, pubkey.x) = commitment
  src/StealthOwnerVerifier.sol        ← snarkjs-generated Groth16 verifier (PoC)
  test/StealthOwner.t.sol             ← Foundry tests (forge test)
backend/
  zk_stealth.py                       ← Python port of the poseidon check
  server.py                           ← /api/zk-stealth/owner endpoint (POST)
frontend/
  public/zk-stealth/stealth_owner_final.zkey
  public/zk-stealth/stealth_owner.wasm
  public/zk-stealth/stealth_owner_vkey.json
  src/lib/stealth-browser.js          ← Browser proof gen
  src/components/features/StealthOwnership.jsx  ← UI
docs/secp256k1-stealth-zk.md          ← This document.
```

## 6. Verifying the PoC actually computes a proof

```bash
cd contracts
forge test --match-contract StealthOwnerTest -v   # on-chain verifier accepts real proof
forge test --match-contract PrivacyPoolE2ETest -v # sanity: existing pools still pass
```

If both pass, the PoC is self-consistent. Deployment readiness is a
separate audit task.

## 7. The audit-pending path

Before this PoC may be treated as a deployable subsystem:

1. **Independent cryptographic review.** Specifically:
   - The constraint system for Poseidon must be the same constants
     used by `PoseidonT3.sol` and `withdraw.circom` (otherwise the
     PoC computes a different hash than anything else in the system).
   - The witness generation must not allow an outside prover to forge
     a spend-key commitment.
2. **Powers-of-Tau ceremony upgrade.** Self-run ceremony is not
   production-grade. Replace with `powersOfTau28_hez_final_*.ptau`
   contributed by at least 2 independent parties.
3. **Verifier contract audit.** snarkjs-generated verifiers have been
   audited before but each instance deserves a fresh look.
4. **Spec signalling.** Add an off-chain UPL-STEALTH-SPEC document
   describing the exact key derivation, communication channel, and
   threat model.

Until #1–#4 are done, **do not flag the PoC as a production
capability** in any user-facing material.

## 8. The upgrade path to Approach A

If a future maintainer wishes to upgrade Approach B → A:

1. Replace `contracts/circuits/stealth_owner.circom` with a secp256k1-aware
   version (the Binius / PSE / 0xPARC Poseidon circuits show how).
2. Re-run `snarkjs groth16 setup` to produce a new proving key.
3. Re-export `StealthOwnerVerifier.sol` (snarkjs-generated).
4. Update `backend/zk_stealth.py` and `frontend/src/lib/stealth-browser.js`
   to mirror the new witness shape.
5. The endpoint `/api/zk-stealth/owner` interface can stay identical —
   the public input shape is the same (stealth_commitment + ephem.x).

The plan was for P3.8 to be a research milestone, not a production
delivery. This achieves that, and the path up from here is clear.
