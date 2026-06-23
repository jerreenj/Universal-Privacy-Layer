# Universal Privacy Layer — Project Context & Plan

> Saved by ZCode on 2026-06-21. This is the running context + roadmap for continuing
> work on this repo. Update it as things change.

## 1. What this project is

**Universal Privacy Layer** (a.k.a. **"PrivacyCloak"**) — a web app for private
cryptocurrency transactions. Goal: make on-chain wallet activity "unlinkable" via
stealth addresses (EIP-5564), end-to-end encryption, and zero-knowledge proofs,
plus private routing for DeFi (Uniswap, Hyperliquid, Polymarket).

- Live site: `privacycloak.in`
- Owner: `jerreenj` (GitHub)
- Built originally by an AI-agent platform ("Emergent"), now being maintained by hand.

## 2. Architecture (the three parts)

| Part | Stack | Entry point | Role |
|------|-------|-------------|------|
| 🖥️ **Frontend** | React 19, react-router 7, ethers v6, wagmi, viem, Tailwind 3, shadcn/ui, framer-motion | `frontend/src/index.js` → `App.js` | Web dashboard (~25 feature screens) |
| ⚙️ **Backend** | Python 3.11, FastAPI 0.110, Motor (async MongoDB), web3.py, pycryptodome | `backend/server.py` (single file, ~3300 lines) | The "brain" — ~80 API endpoints, auth, rate-limiting, sessions |
| 🔗 **Contracts** | Solidity ^0.8.20, Groth16 / BN254 | `contracts/*.sol` (5 files) | On-chain privacy logic (NOT deployed) |

Supporting:
- `Dockerfile` — multi-stage build (Node 20 → Python 3.11)
- `memory/` — PRD + (leaked) credentials — see security section
- `.emergent/` — build-tooling metadata from the Emergent platform
- `README.md` — large marketing-style doc (~500 lines)

## 3. Honest maturity assessment

| Area | Status | Notes |
|------|--------|-------|
| Frontend | ✅ Working | Polished UI, broad feature set |
| Backend | ✅ Working | 80+ endpoints, MongoDB, auth, Dockerized, deployed |
| Contracts | ⚠️ Written, NOT deployed | Placeholder addresses (same fake addr reused for 5 chains), no Hardhat/Foundry |
| ZK proofs | ⚠️ Cosmetic | Backend only format-checks; `Groth16Verifier` had fake key constants (file removed P1.3 / PR #2; dead verifier glue stripped in P1.3 follow-up) |
| Tests | ⚠️ Ad-hoc | 2 manual `requests`-based scripts, not a real suite |
| DeFi privacy | ⚠️ Partial | Mostly prepares/records txs rather than executing private on-chain swaps |

**One-line:** the web app and backend are real and broad; the deeper on-chain crypto
claims outrun what's actually wired up. Normal for early stage — just don't overpromise.

## 4. Known issues (discovered 2026-06-21)

### 🚨 Critical — security
- **Production secrets committed to git** in `memory/test_credentials.md`:
  - VPS root password (value rotated — stored in password manager) at a Hostinger IP (rotated/re-scoped)
  - App access code (value rotated — stored in password manager)
- Access code also hardcoded in `backend/tests/*.py`.
- Secrets span **305 commits** of `main` (single branch).
- **Fix in progress:** see section 6.

### Cleanup
- `.gitignore` is corrupted/duplicated (lines 47–151 repeat junk from bad merges).
- `backend/requirements.txt` bloat: `openai`, `litellm`, `boto3`, `pandas`,
  `huggingface_hub`, `google-genai` are unrelated to the app and widen attack surface.

### Correctness
- ~~`contracts/StealthAddressRegistry.sol` — logic bug in `getByViewTag` fallback.~~
  **FIXED P1.2 (PR #1, commit 2368019):** offset-by-1 `viewTagIndex` mapping, `0 == not found`.
- ~~`contracts/Groth16Verifier.sol` — bogus verification-key constants (would silently
  accept invalid proofs if deployed as-is).~~
  **FIXED P1.3 (PR #2, commit db089bc):** `Groth16Verifier.sol` + `UPLVerifier.sol` deleted
  (DELTA==GAMMA soundness bug; deferred to gated Phase 3). **P1.3 audit follow-up** also
  stripped the backend's dead `ZKP_VERIFIER_ADDRESSES` glue — those addresses were real
  third-party ~2.2 KB verifier contracts the project never deployed or audited; the
  `/api/zkp/verify-onchain` and `/api/zkp/verifier-info/{chain}` endpoints now return
  HTTP 501 ("deferred to Phase 3") rather than `eth_call` into contracts we don't own.

### Docs
- README privacy/security claims ("mathematically unlinkable", "UPL cannot reconstruct
  the path") are not yet backed by deployed cryptography.

## 5. Roadmap (recommended order)

| # | Task | Difficulty | Why |
|---|------|-----------|-----|
| 1 | 🔒 **Security fix** — scrub secrets, rotate passwords, rewrite history | Medium | Only time-sensitive thing |
| 2 | 🧹 **Repo cleanup** — fix `.gitignore`, trim deps | Easy | Reduces attack surface, image size |
| 3 | 📖 **Honest-up README** — soften un-backed claims | Easy | Don't overpromise to users |
| 4 | 🧪 **Real test suite** — convert ad-hoc scripts to pytest | Medium | Confidence before changes |
| 5 | 🐛 **Fix known bugs** — StealthAddressRegistry, Groth16Verifier keys | Medium | Correctness ✅ done P1.2/P1.3 (PR #1 #2) |
| 6 | 🔗 **Make contracts real** — add Foundry, compile/test, real addresses | Hard | Required to deliver on the core promise |
| 7 | 🔐 **Real ZK** — Circom circuits + trusted setup + real verifier | Hard | Deliver on privacy claims |

## 6. Security fix — STATUS & PLAN (task #1)

### Secrets found in 4 files (working tree):
- `memory/test_credentials.md` — VPS root password, IP, access code
- `memory/PRD.md` — VPS IP
- `backend/tests/test_privacy_features.py` — access code (rotated)
- `backend/tests/test_privacy_features_standalone.py` — access code (rotated)

### Plan (3 layers):
1. **Owner rotates live passwords** (only they can):
   - Change Hostinger VPS root password → strong unique value.
   - Change the app `ACCESS_CODE` (env var on the server) → strong unique value.
2. **Code-side scrub:**
   - Replace secrets in the 4 files with placeholders + instructions.
   - Rewrite `.gitignore` cleanly; add `memory/test_credentials.md` and credential patterns.
   - Commit the cleaned files.
3. **History scrub (defense-in-depth):**
   - Use `git filter-repo` to remove secret strings from all 305 commits.
   - Force-push `main`. (Note: GitHub may cache old commits briefly.)

### Status
- [x] Files scrubbed in working tree (4 files cleaned)
- [x] `.gitignore` cleaned + credential patterns added
- [x] Committed (commit `edcaf9f`)
- [x] History rewritten with filter-repo (all 306 commits scrubbed)
- [x] Force-pushed to origin/main (verified clean)
- [ ] Owner rotated VPS root password  ← **STILL NEEDED (repo was PUBLIC)**
- [ ] Owner rotated app ACCESS_CODE     ← **STILL NEEDED**
- [ ] Owner: notify 4 collaborators to re-clone (history was rewritten)
- [ ] Owner: consider GitHub support request to purge cached old commits
      from the public repo (GitHub may retain unreachable objects briefly)

---

*End of context. Append updates below as work progresses.*

---

## 7. Phase 1 progress (2026-06-23)

P1.1 — Relayer reconciliation (contract + backend + frontend), PR #1 (`2368019`):
  - `PrivacyRelayer.sol` rewritten as a gas-only meta-tx forwarder guarded by
    `onlyRelayer`; ABI in `backend/server.py` (`PRIVACY_RELAYER_ABI`) reconciled 1:1
    (`relay`/`feeBps`/`totalRelayed`); `OnChainRelayer.jsx` now signs an EIP-712 intent
    (`signTypedData`) and never broadcasts — `relay()` would revert and leak the user's
    wallet as `msg.sender`. Backend `/api/relayer/prepare-tx` returns the typed-data
    payload + fee quote; `/api/relayer/stats/{chain}` reads `totalRelayed`+`feeBps`.
  - Field contracts (backend ``submission.expires_at``/``.note``, frontend reads) verified.

P1.2 — Registry `getByViewTag` off-by-one + EIP-5564 cleanup, same PR #1:
  - `viewTagIndex[viewTag]` now stores `real_index + 1` so `0` means "not found"
    (was colliding with announcement #0); backend read paths reconciled.

P1.3 — Remove unsound ZK verifiers, PR #2 (`db089bc`):
  - Deleted `Groth16Verifier.sol` (DELTA==GAMMA — would accept forged proofs) and the
    orphaned `UPLVerifier.sol`. No repo references remained to the Solidity files.

P1.3 audit follow-up (this PR #3):
  - **Audit finding (on-chain):** `eth_getCode` on the backend's advertised
    `UPL_CONTRACTS` addresses (`0x0A81…5c` = 251 B, `0xf2E7…Ff4` = 418 B) shows they
    are NOT our reconciled contracts — selector sweep finds 2/3 selectors vs our 6+
    per contract, and the deployed registry exposes `owner()` which our
    `StealthAddressRegistry` doesn't even inherit. The deployed addresses are the
    placeholder contracts flagged in section 3 ("Contracts ⚠️ Written, NOT deployed").
    **Out of scope here** — that's P1.6/P1.9 (Hardhat deploy + real `deployed_base.json`).
  - **Audit finding (soundness):** the dead `ZKP_VERIFIER_ADDRESSES`/`ZKP_VERIFIER_ABI`
    glue still `eth_call`'d into real third-party ~2.2 KB Groth16 verifiers we never
    owned (verified deployed at all 6 hardcoded addresses on their chains). Stripped:
    `/api/zkp/verify-onchain` and `/api/zkp/verifier-info/{chain}` now return HTTP 501
    ("deferred to Phase 3"); `/api/zkp/submit-proof` keeps its format-only check but
    no longer returns a dangling `verifier_contracts` table.
  - **Doc drift fixed:** README.md contract tree + Smart Contracts table no longer
    list the deleted files; pragma corrected to `^0.8.20`; ZK row in section 3,
    Correctness section, roadmap row #5 all annotated with their PR refs.

Still outstanding (Phase 1): P1.4–P1.17 — wire `UniswapPrivacyWrapper`, per-chain
`deployed_base.json`, deploy real contracts to Base, build the real relayer service,
move announcements on-chain, wire the frontend E2E, run a real private-send on Base
and prove the stealth output is unlinkable from the sender.
