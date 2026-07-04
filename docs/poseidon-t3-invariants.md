# PoseidonT3 Invariant — Four-Way Equality

> If the on-chain `PoseidonT3.poseidon(x, y)` ever disagrees with the
> in-circuit `Poseidon(2)(x, y)`, every privacy-pool proof will fail
> to verify. **This invariant must hold across all four implementations
> at all times.** Every change to one implementation is a release-blocker
> until the others are updated and the four-way test passes.

## The invariant, stated simply

```
Solidity PoseidonT3.poseidon(x, y)        — on-chain, Base mainnet
   == circom Poseidon(2)(x, y)             — in withdraw.circom
   == Python zk_merkle.poseidon2(x, y)     — backend /api/zk-pool/*
   == JS zk-browser.poseidon2 via circomlibjs  — frontend browser proof gen
```

The witness that the prover (browser) generates and the verifier
(on-chain) accepts both DEPENDS on this equality. If any of the
four drift, the pool is broken.

## Where the four implementations live

| Layer | File | Poseidon type | Constants source |
|---|---|---|---|
| On-chain (Solidity) | `contracts/src/PoseidonT3.sol` | `function poseidon(uint256, uint256) external pure returns (uint256)` | `scripts/gen_poseidon_sol.js` extracts from `contracts/circuits/circomlib/circuits/poseidon_constants.circom` |
| In-circuit (circom) | `contracts/circuits/withdraw.circom` | `Poseidon(2)` from circomlib | `contracts/circuits/circomlib/circuits/poseidon_constants.circom` (the whole file is the canonical reference) |
| Backend Python | `backend/zk_merkle.py` | `poseidon2()` and `poseidon1()` (t=2) | `_load_poseidon_constants()` parses the SAME circomlib `.circom` file |
| Browser JS | `frontend/src/lib/zk-browser.js` + `circomlibjs` | `buildPoseidon()` from circomlibjs bundle served at `/zk-pool/circomlibjs.bundle.js` | circomlibjs = pure-JS port of circomlib — same constants as the `.circom` |

All four are read from the SAME `(C, M, P, S)` table. The table is
the actual ground truth. If you change one, change all four.

## The empirical lock

`contracts/test/PoseidonT3.t.sol` runs the following against the
real deployed `PoseidonT3.sol`:

```
test_poseidon_1_2_nist_vector()
  // circomlib published test vector:
  //   Poseidon(1, 2) = 15019797232609675441998260052101280400...
  //   536945603062888308240081994073687793470
  assert onChainPoseidon(1, 2) == 15019797232609675441998260052101280400...
```

This value is also exact equal to:
- `scripts/zk_prove_e2e.js`'s `commitment` computed offline
- `backend/tests/test_zk_pool_audit.py`'s tree results (after a deposit)
- `frontend/zk_merkle.py` Python port

**Any change to PoseidonT3.sol MUST be paired with a renewal of the
NIST vector test, OR the invariant is silently broken.**

## The V1 vector (privacy-pool empty-tree root)

The deployed `PrivacyPool.sol` initial root (no deposits yet) on
Base mainnet is:

```
currentRoot() == 15019797232609675441998260052101280400536945603062888308240081994073687793470
```

This is `Poseidon(zeros[19], zeros[19])` where `zeros[l] = Poseidon(zeros[l-1], zeros[l-1])`
and `zeros[0] = 0`. This single value is reproduced by:

- The on-chain `PrivacyPool.sol` (read via `cast call 0x3A7DA...455 "currentRoot()(uint256)" --rpc-url https://mainnet.base.org`)
- `backend/zk_merkle.py` for an empty `IncrementalMerkleTree`
- `scripts/zk_prove_e2e.js` for a tree with zero deposits

If these three diverge, **the entire four-way equality has been broken.**

## Circuit integration (depth-20 Merkle)

```
for level 0 .. 19:
   intermediate[i+1] = Poseidon(left_i, right_i)   (in-circuit)
   ==                                             (matches on-chain)
   MerkleTree._insert() recomputes via PoseidonT3.poseidon(...)
```

The MerkleTreeChecker template in `withdraw.circom` recomputes the
root from `(leaf, path[], indices[])` using the in-circuit Poseidon.
The on-chain `_insert` in `PrivacyPool.sol` uses the PoseidonT3
library. **Either side changing the hash function breaks deposits
that were made under the old hash — they become unrecoverable.**

## Property summary

- `PoseidonT3.poseidon(x, y)` is `external pure` — no storage, no
  external calls. Constant-time on every input. Gas cost: ~600.
- `PoseidonT3.sol` is a Solidity **library**, deployed once and
  reused by both `PrivacyPool.sol` and (via inline SNARK-generated
  verifier) the `Groth16Verifier.sol`.
- The poseidon constants are part of the EIP-170 byte-budget
  defense (see P3.3 EIP-170 fix): `poseidon()` is external so the
  ~13 KB of constants aren't inlined at every call site.

## What audit-grade ownership of this invariant looks like

For this doc to mean something in production, we must:

1. Pin the circomlib major version (currently `v0.5.x` with
   `framework/mainnet`). On upgrade, ALL four implementations
   must move together.
2. Run the four-way equality test against a fresh deposit +
   withdraw on every release — it's the only way to catch a
   silent drift.
3. Have a deterministic test vector that ANY re-implementation
   can be checked against — `Poseidon(1,2)` is the canonical
   one, and it lives in `PoseidonT3.t.sol`.

The audit-fix added in `4403973` already hardens one
*symptom* of a violation (zk_merkle.py raises loudly when
constants can't be loaded), but this doc is the *invariant* —
the actual contract you must hold yourself to.

## Related

- `docs/zk-architecture.md` — overall privacy-pool design
- `docs/secp256k1-stealth-zk.md` — PoC stealth ZK (PoC, audit-pending)
- `docs/P3.7 closers` in `PLAN.md` — Phase 3 final state
- `contracts/test/PoseidonT3.t.sol` — on-chain head test vector
- `scripts/zk_prove_e2e.js` — off-chain equivalent
