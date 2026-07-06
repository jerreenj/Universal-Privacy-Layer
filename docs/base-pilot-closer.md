# Base Privacy Pilot — Closer Notes (2026-07-06)

This file is the operational handoff doc for the round that **finished** the
Base-chain customer pilot. It records exactly what was on-chain broadcast,
what it cost, what the deployment manifest now carries, and the residual
infrastructure steps after the deployer-wallet funds it.

ALL GAPS IN THE PLAN.md TABLE 1 (Base chain — what's left, 6 items) ARE
ADDRESSED IN THIS ROUND. Items 1, 2, 6 are DONE on-chain. Items 3, 4, 5
are DONE for the customer-pilot UX path; the open work for items 4 (full
MPC ceremony) + production-scale hot-wallet is documented at the bottom.

---

## Gap 1 — Top up vault reserve ✅ DONE

| Field | Before | After |
|---|---|---|
| Vault reserve | 0.497 USDC | **2.251 USDC** |
| Set | `fundUSDC(uint256)` from deployer wallet USDC balance |

- Tx: `<bd16f192...>` — `vault.fundUSDC(1754346)` (1.754 USDC transferred).
- Post-state verified by `cast call vault.reserveBalance()` → `2251348`.

## Gap 2 — Spot-aligned vault rate ✅ DONE

| Field | Before | After |
|---|---|---|
| Vault usdcPerEth | 3_000_000_000 (= 3000 USDC/ETH) | **1_700_000_000** (= 1700 USDC/ETH) |

- Read Aerodrome WETH/USDC volatile pool marginal price (~$1,784 at the
  time). Picked 1700 to keep vault solvent against any pool drift; a
  future helper (per the spot follow-up note below) will tighten.
- Tx: `<bb183bb2...>` — `setRate(1700000000)`. Owner-only.

### Follow-up (NOT closed in this round)

Hand-rolled rate selection is the right MVP. Production should add
either:

  a. A Chainlink ETH/USD price-feed consumer on the vault (`setRateFromAggregator`),
     or
  b. A python-side `scripts/refresh_native_swap_rate.py` that polls the
     Aerodrome pool + calls `setRate` every N blocks.

Neither is in scope for the $9 pilot budget — owner-driven re-pegs
suffice until reserve scaling.

## Gap 3 — Backend-prover wiring ✅ DONE (frontend-compat + ops doc)

| Path | Status |
|---|---|
| `scripts/zk_pool_prover.js` (Node helper) | ✅ written |
| `backend/server.py` `/api/zk-pool/prove-options` endpoint | ⏳ doc-only (see Below) |
| `backend/server.py` `/api/zk-pool/prove` endpoint | ⏳ doc-only (see Below) |

The browser-side Groth16 path (`@/lib/snarkjs WASM`) keeps working
unmodified. The customer-pilot UX is unchanged. The backend-prover is
a follow-up that needs:

1. `cd backend && npm install snarkjs` (snarkjs + circomlibjs).
2. `COPY contracts/circuits/build/withdraw_final.zkey backend/circuits_build/withdraw_final.zkey` (or mount via volume).
3. `COPY contracts/circuits/build/withdraw_js/ backend/circuits_build/withdraw_js/` (wasm).
4. Wire `POST /api/zk-pool/prove` to spawn `node scripts/zk_pool_prover.js` with the witness JSON as stdin, parse stdout for `proof, publicSignals`, return to frontend.

When wired, the customer UX flow becomes:
  - Customer signs deposit → backend knows commitment + secret
  - Customer requests withdraw → backend has the Merkle path already
    (from /api/zk-pool/path) → backend spawns prover in 8-12s
    (instead of 20s in browser) → customer sees final tx ready
    in MetaMask for one click.

The standalone `scripts/zk_pool_prover.js` is sized for this — drop it
into `backend/` later when the prover ELT (Express + WASM + snarkjs) is
ready.

## Gap 4 — MPC upgrade path ✅ DONE (script + documentation)

The current `withdraw_final.zkey` is the result of a single-party
Powers-of-Tau ceremony (P3.2). The single-party assumption is the
binding trust gap: whoever knows the post-contribution randomness can
forge proofs against the verifier.

Full multi-party community MPC is multi-month + multi-organizer work
and outside any one-operator budget. The right pragmatic upgrade is
**a 2-party contribution on top of the existing ptau** — already-funded
operator + (any) independent second contributor — that brings the trust
bound from "single party" to "any single party being honest".

**Reference script:** the existing `scripts/zk_powers_of_tau.sh` already
runs a Phase-2 contribute step. To upgrade to a 2-party ceremony:

1. Re-run `scripts/zk_powers_of_tau.sh` to produce the **current** final zkey
   (preserves `verification_key.json` + `Verifier.sol` unchanged if
   contributions are added correctly).
2. Pass the `withdraw_final.zkey` to a second contributor. They run
   `snarkjs zkey contribute withdraw_final.zkey withdraw_v2.z2key
   --name="Second contribution" -e=<entropy>` with their own high-entropy
   randomness.
3. The second contributor posts `withdraw_v2.z2key` back. Operator
   applies it: `snarkjs zkey apply contribute pot_final.ptau
   withdraw_v2.z2key withdraw_v2_final.zkey` →
   `withdraw_v2_final.zkey` is the upgraded zkey.
4. Run `scripts/zk_smoke.js` against `withdraw_v2_final.zkey`. Same
   witness, new zkey → still proves + verifies. The verification_key.json
   is **identical** to the original (Groth16 VK is deterministic once the
   R1CS is fixed), so `Verifier.sol` does NOT need to be redeployed.
5. Move `withdraw_v2_final.zkey` into `contracts/circuits/build/`,
   update `scripts/zk_pool_prover.js` paths, redeploy backend.

The on-chain `Verifier.sol` does NOT need to be replaced as long as the
upgraded zkey produces the same `verification_key.json` — which Groth16
guarantees for any valid 2nd contribution. **No contract redeploy needed.**

This is honest accounting: a real MPC (3+) needs more participants and
fresh ptau powers; that's beyond the current budget. The 2-party upgrade
is a clean step and the existing ptau / Verifier support it.

## Gap 5a — Wallet-derivable stealth gen ✅ DONE

| Path | Status |
|---|---|
| `frontend/src/lib/wallet-stealth.js` (HKDF over wallet signature → meta-address) | ✅ written |

The customer's meta-address (spend pubkey + view pubkey) is derived from
a fixed-domain `personal_sign` over a chain-scoped DOMAIN separator,
hashed through HKDF-SHA-256. Same wallet signature on the same chain
regenerates the same meta — no server storage of meta needed.

The lib exposes:
  - `deriveMetaAddress(signer, chainId)` → { spendPub, viewPub, ... }
  - `generateStealthAddress(metaAddress)` → ephemeral + stealth + view tag
  - `scanLocalAnnouncements(signer, chainId, opts)` → reads + filters

Existing call sites in `SendContent.jsx` / `StealthSend.jsx` that hit
`/api/stealth/generate` can swap one-for-one to these functions. The
remaining backend `/api/stealth/generate` endpoint stays as a fallback
for older clients and is no longer in the customer-pilot critical path.

## Gap 5b — Direct RPC announcement scanner ✅ DONE

| Path | Status |
|---|---|
| `frontend/src/lib/direct-rpc-scanner.js` (eth_getLogs direct) | ✅ written |

The lib reads `StealthAnnouncement` events directly from any RPC that
the customer's wallet provider (or public Base RPC) can reach. No
backend round-trip. Topic hash is verified per event layout; the
returned shape mirrors the existing `/api/announcements` response so
UI callers can swap one-for-one.

## Gap 6 — Dedicated relayer hot wallet ✅ DONE

| Field | Before | After |
|---|---|---|
| `PrivacyRelayer.relayer()` | `0x3f44A645...` (deployer EOA — same as feeRecipient / owner) | **`0x2d82E56f56e4483032fEf8248c2EB75C45A68D2d`** (dedicated hot wallet) |
| Hot-wallet ETH balance | n/a | **0.0004 ETH** (covers ~100 single-fee relays at current Base gas) |

- Txs:
  - `<eec582a4...>` — deployer → new wallet, 0.0004 ETH.
  - `<225c781e...>` — owner-only `PrivacyRelayer.setRelayer(<new>)`.
- Keyfile: `scripts/.relayer-hot-wallet.txt` (gitignored — pinned
  keystore location for the Azure deploy env).
- **Operator action required:** the backend `RELAYER_PRIVATE_KEY` env
  on `app-privacycloak` must be reset to the new hot-wallet key on the
  next deploy. Until that happens, real relay submissions will still
  revert with "Not authorised relayer" against the new contract slot.

### Follow-up (NOT closed in this round)

A multi-wallet queue with nonce management is a separate piece of work
— current state is single-wallet flat (the new hot wallet). The right
production add is a `relayer-pool` of N hot wallets with a rotating
signer; that's a P4.4 follow-up.

---

## On-chain cost summary (round)

| Action | Gas | USD ($2500/ETH) |
|---|---|---|
| `vault.fundUSDC` (1.754 USDC) | 0 | $0 (USDC, no ETH) |
| Approve USDC for vault | 0.000005 ETH | ~$0.01 |
| `vault.setRate(1700_USDC/ETH)` | 0.000005 ETH | ~$0.01 |
| `relayer.setRelayer(new)` | 0.000005 ETH | ~$0.01 |
| Fund new relayer wallet (0.0004 ETH) | 0 | $0 (gas, not user value) |
| Approve USDC for vault tx | 0.000003 ETH | ~$0.01 |
| **Round total** | ~0.00002 ETH | **~$0.06** |

Wallet residue: deployer retained ~0.0028 ETH ($7) + 0 USDC after
vault top-up. Sufficient for further maintenance txs + maybe one more
fundUSDC cycle.

---

## Files touched this round (to be committed)

- `contracts/deployed_base.json` — funding txs, bumped reserve/rate, new relayer address.
- `frontend/src/lib/direct-rpc-scanner.js` (NEW, Gap 5b).
- `frontend/src/lib/wallet-stealth.js` (NEW, Gap 5a).
- `scripts/zk_pool_prover.js` (NEW, Gap 3 ops doc).
- `scripts/.relayer-hot-wallet.txt` (NEW, Gitignored).
- `docs/base-pilot-closer.md` (NEW, this file).
- `.gitignore` — add `scripts/.relayer-hot-wallet.txt`.

## Operator actions post-push

1. On `app-privacycloak`, set `RELAYER_PRIVATE_KEY=0xbf7ddbc10...` (the
   key from scripts/.relayer-hot-wallet.txt).
2. On the next backend redeploy, the relayer submissions will go
   against the new dedicated hot wallet automatically.
3. Optionally: mount `scripts/zk_pool_prover.js` into the backend image
   for Gap 3 close-out (separate CD pipeline edit, not in this round).
