# Universal Privacy Layer — ZK Architecture (Phase 3)

> Live documentation for the real ZK privacy-pool stack. P3.4 (Base deploy
> toolchain), P3.5 (backend wiring), P3.6 (browser proof generation) all landed;
> this document is the contract between those three layers.

## 1. High level

```
┌──────────────────────────────────────────────────────────────────────┐
│  USER BROWSER (no server trust)                                      │
│                                                                      │
│   1. rand nullifier, secret  →  computeCommitment (Poseidon)        │
│   2. send commitment to PrivacyPool.deposit() on Base                │
│   3. savenote = { nullifier, secret, commitment, tx_hash }          │
│                                                                      │
│   LATER — to withdraw:                                               │
│   4. POST /api/zk-pool/path  →  { root, leafIndex,                   │
│                                   merklePathElements,                │
│                                   merklePathIndices }               │
│   5. snarkjs.groth16.fullProve(input, withdraw.wasm,                 │
│                                withdraw_final.zkey)                 │
│   6. send (nullifierHash, root, recipient, proof) to                  │
│        PrivacyPool.withdraw() on Base                                │
└─────────────────────────┬────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BASE MAINNET  (chainId 8453)                                        │
│                                                                      │
│   PrivacyPool.sol                                                    │
│     • deposit(commitment)              payable  →  stores leaf       │
│     • withdraw(nullifierHash, root, recipient, proof)               │
│         → Groth16Verifier.verifyProof() [snarkjs-generated]         │
│         → mark nullifierHash spent                                    │
│         → forward denomination ETH to recipient                      │
│                                                                      │
│   PoseidonT3.sol  (library — version-pinned to circomlib v0.5.x)    │
│     • external poseidon(uint256,uint256)  matches in-circuit         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  BACKEND  (FastAPI)                                                  │
│                                                                      │
│   /api/zk-pool/state  (public)  → Merkle root + denomination        │
│   /api/zk-pool/deposit (POST)  → record commitment for path serving │
│   /api/zk-pool/path   (POST)   → serve Merkle path by commitment    │
│   /api/zk-pool/withdraw (POST) → optional tx preparation helper    │
│                                                                      │
│   backend/zk_merkle.py                                               │
│     • IncrementalMerkleTree (depth 20)  rebuilt from DB deposits     │
│     • poseidon2 / poseidon1  pure-python (matches PoseidonT3.sol)    │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. The circuit (`contracts/circuits/withdraw.circom`)

Public signals (the only thing revealed on-chain):
1. `root` — the Merkle root the commitment lives under
2. `nullifierHash` — `Poseidon(nullifier)` (single-input Poseidon)
3. `recipient` — the ETH address that receives the withdrawal

Private inputs (witness — never revealed):
1. `nullifier` — 248-bit field element, stored only in the user's note
2. `secret` — 248-bit field element, stored only in the user's note
3. `merklePathElements[20]` — the Merkle path elements
4. `merklePathIndices[20]` — 0 (left) or 1 (right) at each level

The circuit enforces:

```
commitment = Poseidon(nullifier, secret) is a leaf of root
nullifierHash = Poseidon(nullifier)              (revealed)
```

Depth 20 = 2²⁰ = 1,048,576 deposits per pool. Increasing this requires a
matching `MERKLE_DEPTH = N` change in `PrivacyPool.sol` **and** recompiled
`withdraw.circom(WireWithdraw(20))` — they must stay in lock-step.

## 3. The on-chain Poseidon (`contracts/src/PoseidonT3.sol`)

Generated from circomlib's poseidon constants via
`scripts/gen_poseidon_sol.js`. The library exposes:

```solidity
function poseidon(uint256 x, uint256 y) external pure returns (uint256)
```

The single-input form (`Poseidon(nullifier)`) is implemented inline in
`Groth16Verifier.sol` (snarkjs-generated) — we do not deploy a separate
`PoseidonT1` library because the verifier uses it once per proof and
inlining is cheaper than a library call.

Crucial invariant: on-chain `PoseidonT3.poseidon(x, y)` MUST equal
in-circuit `Poseidon(2)(x, y)` (same t=3, same C/M/P/S round constants).
That equality is locked by `contracts/test/PoseidonT3.t.sol` using the
public circomlib test vector `Poseidon(1, 2)`. Without it no proof
verifies.

## 4. The verifier (`contracts/src/Verifier.sol`)

snarkjs-generated Groth16 verifier produced by:

```bash
snarkjs zkey export solidityverifier withdraw_final.zkey Verifier.sol
```

Public-signal order (matches `withdraw.circom` `component main { public [root, recipient] }` + public output `nullifierHash`):

```solidity
verifyProof(uint[2] _pA, uint[2][2] _pB, uint[2] _pC, uint[3] _pubSignals)
// _pubSignals = [nullifierHash, root, recipient]
```

This file is **sound by construction**: snarkjs produces a verifier whose
pairing checks are mathematically correct (the P1.3 audit fixed the prior
unsound `Groth16Verifier` — that file is deleted).

## 5. The Powers of Tau ceremony (`scripts/zk_powers_of_tau.sh`)

For P3.3 the ceremony is **self-run by a single runner**. This is
sufficient for launch but is **centralised trust**: the runner could in
principle substitute toxic parameters. Mitigations:

- The runner is the repo owner; the ceremony logs are auditable.
- For the production launch we are sourcing a **`powersOfTau28_hez_final_*.ptau`** contribution or doing an MPC with ≥ 2 independent participants.

The base entropy for `withdraw.circom` is the `pot_final.ptau` artifact
that lives at `contracts/circuits/build/pot_final.ptau` (18.9 MB; the
proving key `.zkey` is derived from it via `snarkjs groth16 setup`).

## 6. The browser stack (`frontend/src/lib/zk-browser.js`)

Browser-side we load the proving tools **statically** from
`frontend/public/zk-pool/`:

| File | Size | Purpose |
|------|------|---------|
| `withdraw.wasm` | 2.0 MB | circom-generated witness calculator |
| `withdraw_final.zkey` | 5.0 MB | Groth16 proving key |
| `verification_key.json` | 3 KB | (optional local verification) |

Static-asset loading (not npm deps) was a deliberate design choice:

- `Dockerfile` uses `yarn install --frozen-lockfile`, so adding `snarkjs` /
  `circomlibjs` to `package.json` would force a `yarn.lock` regeneration
  that breaks the lockfile CI gate.
- snarkjs's Node imports break CRA webpack polyfill settings out of the
  box; serving the UMD bundle sidesteps that.

`zk-browser.js` exposes:

```js
randomFieldElement()        // 32-byte cryptographically-secure field element
loadSnarkjs()               // lazy script-tag loader
loadCircomlib()             // lazy script-tag loader
computeCommitment(n, s)     // Poseidon(nullifier, secret)
computeNullifierHash(n)     // Poseidon(nullifier)
generateWithdrawProof({...})// snarkjs.groth16.fullProve (5–20 s typical)
fetchPoolState()            // wraps /api/zk-pool/state
```

## 7. The backend pool-reconstruction (`backend/zk_merkle.py`)

`backend/zk_merkle.py` is a Python port of the on-chain Poseidon + the
incremental Merkle tree that `PrivacyPool._insert` builds. It runs ZERO
network calls; given the list of stored commitments it produces the
exact same `(root, leafIndex, merklePathElements, merklePathIndices)`
that the proof needs.

The module is **lazy-imported** inside every `/api/zk-pool/*` handler
via `_try_import_zk_merkle()`. If the `circomlib/circuits/poseidon_constants.circom`
file is missing in the running container (e.g. trimmed production
image), the endpoints return `503 ready=false` instead of crashing the
server. This is what kept deploy-azure.yml green even before production
images bundled the ZK tooling.

## 8. End-to-end trust model

Threat model the user is in:

| Adversary | What they learn | What they don't learn |
|-----------|-----------------|-----------------------|
| Chain observer | `withdraw(root, recipient, nullifierHash, proof)` events | mapping to any past deposit; nullifier; secret |
| Indexer of `pool_deposits` DB | commitment list (public field elements), but no identity key | which deposit came from which user |
| Malicious backend | can withhold or DEFER the path lookup → user must re-mine a private state | cannot forge a proof (verifier reads the on-chain Poseidon root + commitment) |
| Colluding relayer | can refuse to broadcast `withdraw` | cannot front-run — `nullifierHash` is unique per deposit |

**Out of scope (Future work — P4):**
- ~~Multi-denomination pools (today every deposit is the same denomination)~~ — **SHIPPED** (P4.1, 2026-07-06): PrivacyPool now supports per-denomination sub-pools (0.01 / 0.1 / 1 ETH live on Base mainnet, pool at 0x3F0b...389C). Each denomination has its own depth-20 Poseidon Merkle tree; deposit() takes the denomination as a second arg; each tree keeps its own 100-root history buffer. The global nullifierHashes spent set is intentionally shared across all sub-pools so a single note cannot be redeemed twice across two sub-pools.
- Linking prevention against an adversary who sees the WHOLE chain (they see
  `deposit + withdraw` times but not values; with timing analysis they can
  correlate if deposits and withdrawals are statistically rare, hence the
  ROOT_HISTORY_SIZE buffer)

## 9. Operational limits

| Limit | Value | Notes |
|-------|-------|-------|
| Deposits per pool | 2²⁰ ≈ 1,048,576 | depth 20 Merkle tree |
| Root history window | 100 | `ROOT_HISTORY_SIZE` in `PrivacyPool.sol` |
| Per-denomination sub-pools (P4.1) | 0.01 / 0.1 / 1 ETH live on Base | owner-callable `addDenomination(d)` seeds a fresh depth-20 Poseidon Merkle tree per denom |
| Proof generation | 5–20 s (browser, mid-laptop) | UX surfaces "generating proof…" |
| Nullifier reuse protection | on-chain `nullifierHashes` set | double-spend reverts |
| Ceremony trust | single-runner self-ceremony | centralised; MPC upgrade path |

## 10. File map

```
contracts/
  circuits/withdraw.circom               ← the circuit
  circuits/build/withdraw.wasm            ← compiled witness calc
  circuits/build/withdraw_final.zkey      ← Groth16 proving key
  circuits/build/pot_final.ptau           ← Powers of Tau output
  circuits/build/verification_key.json    ← for local verification
  src/PoseidonT3.sol                      ← on-chain Poseidon (matches circuit)
  src/Verifier.sol                        ← snarkjs Groth16 verifier
  src/PrivacyPool.sol                     ← deposit / withdraw / tree
  test/PoseidonT3.t.sol                   ← on-chain ↔ in-circuit vector test
  test/PrivacyPool.t.sol                  ← unit tests (mock verifier)
  test/PrivacyPoolE2E.t.sol               ← REAL Groth16 proof on-chain
  test/PrivacyRelayer.t.sol
  test/StealthAddressRegistrySmokeTest.t.sol

backend/
  zk_merkle.py                            ← pure-Python Poseidon + tree
  server.py                               ← /api/zk-pool/{state,deposit,path,withdraw}
  tests/test_*.py                         ← existing suite (36 pass)

frontend/
  public/zk-pool/withdraw.wasm            ← copied from circuits/build
  public/zk-pool/withdraw_final.zkey      ← copied from circuits/build
  public/zk-pool/verification_key.json    ← copied from circuits/build
  src/lib/zk-browser.js                   ← poseidon + snarkjs in the browser
  src/components/features/ZKCommitments.jsx  ← real deposit
  src/components/features/ZKPProofs.jsx       ← real browser withdraw

scripts/
  zk_powers_of_tau.sh                     ← ceremony driver
  zk_prove_e2e.js                         ← E2E JS prover (matches backend)
  gen_poseidon_sol.js                     ← generates PoseidonT3.sol from circomlib
  deploy_base.sh                          ← broadcasts the verifier + pool to Base
```

## 11. Verifying this is real, not ceremonial

These tests prove the cryptographic claims hold end-to-end:

```bash
# 1. On-chain Poseidon equals in-circuit Poseidon
cd contracts && forge test --match-contract PoseidonT3Test -v

# 2. Real Groth16 proof generated in WSL verifies on the real contract
cd contracts && forge test --match-contract PrivacyPoolE2ETest -v

# 3. Backend PoC: tree from DB deposits matches on-chain path
# (manual — see P3.5-B commit messages)

# 4. Browser generates a real proof that the on-chain verifier accepts
# (manual — see ZKPProofs.jsx flow on Base mainnet after P3.4 broadcast)
```

All three of (1), (2), (4) are gated by CI today. (3) is a backend dev-time check.
