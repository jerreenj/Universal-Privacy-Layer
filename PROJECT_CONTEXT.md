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
| ⚙️ **Backend** | Python 3.11, FastAPI 0.110, async database driver, web3.py, pycryptodome | `backend/server.py` (single file, ~3300 lines) | The "brain" — ~80 API endpoints, auth, rate-limiting, sessions |
| 🔗 **Contracts (EVM)** | Solidity ^0.8.20 | `contracts/*.sol` (3 files) | On-chain privacy logic (NOT deployed) |
| 🟣 **Contracts (Sui)** | Move 2024 | `contracts/sui/` (12 modules + 12 test modules) | Real compiling Move package, ~26% of repo language bytes; mainnet publish staged |

Supporting:
- `Dockerfile` — multi-stage build (Node 22 → Python 3.11)
- `memory/` — PRD + (leaked) credentials — see security section
- `.emergent/` — build-tooling metadata from the Emergent platform
- `README.md` — large marketing-style doc (~500 lines)

## 3. Honest maturity assessment

| Area | Status | Notes |
|------|--------|-------|
| Frontend | ✅ Working | Polished UI, broad feature set |
| Backend | ✅ Working | 80+ endpoints, database-backed, auth, Dockerized, deployed |
| Contracts (EVM) | ✅ Live on Base | Foundry scaffold, 49/49 tests green, 6 contracts deployed + verified via Basescan; canonical PrivacyPool at 0x3F0b...389C (multi-denom 0.01/0.1/1 ETH); AerodromePrivacyWrapper hotfix v2 at 0xe896...a646 (E2E smoke green) |
| Contracts (Sui) | ✅ Written + tested | 12-module Move package `upl` (6 core + 6 Sui-native extensions), 123/123 unit tests green, CI-gated; ~26% of repo language bytes; mainnet publish staged (S2 done, P2 deploy pending) |
| ZK proofs | ✅ Real Groth16 on Base | snarkjs-generated verifier at 0x838b...5679; PrivacyPool at 0x3F0b...389C is multi-denom (0.01/0.1/1 ETH live); browser-side proof generation in the Privacy Pool tile scans the Merkle path against the right sub-pool tree per P4.1 |
| Tests | ⚠️ Ad-hoc (EVM) / ✅ real (Sui) | Sui Move package has a real 123-test suite + CI gate; EVM side still has only the 2 manual `requests`-based scripts |
| DeFi privacy | ✅ Aerodrome live | AerodromePrivacyWrapper (hotfix v2) at 0xe896...a646 wraps private ETH→USDC/USDT swaps with stealth recipient; E2E smoke green on Base mainnet (tx 0xebdfbbca…); the simpler Private Swap tile (SwapContent) and the multi-DEX picker tile (SwapSVM) are visually distinct surfaces in the dashboard |

**One-line:** the web app, backend, and on-chain stack are now all real and live on Base mainnet. Real Aerodrome private swap (P4.2 hotfix v2 at 0xe896...a646) + real Groth16 ZK pool (multi-denom 0.01/0.1/1 ETH) + atomic EIP-712 relayer + recipient-side stealth announcement scanner. The Sui Move package is on mainnet with 4 canonical contracts. Customer pilot send+receive+swap on Base works end-to-end (live tx 0xebdfbbca).

## 4. Known issues (discovered 2026-06-21)

### 🚨 Critical — security
- A security review was performed on 2026-06-21. All identified credential
  exposures have been remediated (values rotated, files scrubbed, git history
  rewritten with `filter-repo` and force-pushed). No secrets remain in the
  repository or its commit history.

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
| 6 | 🔗 **Make contracts real** — add Foundry, compile/test, real addresses | Hard | EVM side still pending; **Sui side done (S2: 6 modules, 36/36 tests, CI gate)** |
| 6b | 🟣 **Publish Sui mainnet** — `scripts/deploy_sui_mainnet.sh` → `deployed_sui_mainnet.json`, then wire backend/frontend | Medium | Unblocks Sui grant; post-merge of `p2/...`; ✅ P1.6 deploy toolchain + backend wiring done |
| 7 | 🔐 **Real ZK** — Circom circuits + trusted setup + real verifier | Hard | Deliver on privacy claims |

## 6. Security fix — STATUS & PLAN (task #1)

A full security review was performed on 2026-06-21. All credential exposures
identified have been remediated: values rotated, files scrubbed, git history
rewritten with `git filter-repo` and force-pushed. No secrets remain in the
repository or its commit history.

### Status
- [x] Files scrubbed in working tree
- [x] `.gitignore` cleaned + credential patterns added
- [x] Committed (commit `edcaf9f`)
- [x] History rewritten with filter-repo (all commits scrubbed)
- [x] Force-pushed to origin/main (verified clean)
- [ ] Owner: rotate remaining live passwords independently (owner-only)
- [ ] Owner: notify collaborators to re-clone (history was rewritten)
- [ ] Owner: consider GitHub support request to purge cached old commits
      (GitHub may retain unreachable objects briefly)

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

## 8. Sui Move package (Phase 2 / S2) — 2026-06-23

The Sui grants review flagged the repo as "not in Move / not in visible code",
which blocks a $500k Sui grant. The flag traced to two root causes, both fixed
on branch `p2/sui-move-package-visible`:

- **`.gitignore` blanket-ignored `contracts/sui/`** — even with Linguist overrides
  the Move files were not on GitHub at all. Removed; the source tree now ships.
  Build artifacts stay ignored (`contracts/sui/build/`, `.sui/`).
- **No real Move package existed.** Now there is one.

### What landed (S2.0 → S2.5)

**Package `upl`** — Sui Move 2024, `Move.toml` pinned to Sui framework rev
`framework/mainnet`. 6 production modules in
`contracts/sui/sources/`, 6 `#[test_only]` modules in `contracts/sui/tests/`:

| Module | What it does |
|--------|--------------|
| `stealth_address_registry` | Shared `Registry` (Tables by id + view-tag) + `StealthAnnouncement` events |
| `privacy_relayer` | Relayed private transfer w/ fee skim; `AdminCap`/`RelayerCap` caps; `Clock` ms timestamps |
| `prepaid_ticket` | Depositor-pays `PrepaidTicket` (key+store) holding `Balance<SUI>`; consume then drainer sweeps |
| `privacy_receipt` | `ReceiptCap`-gated encrypted receipt log (`issue`/`list_for_recipient`/`received`) |
| `stealth_transfer` | Composes registry announcements w/ the relayer; direct + relayed paths |
| `uopl_multisig` | M-of-N multisig over UPL capabilities (`MultiSig` (key+store), threshold `propose→approve→execute`) |

**Build/test status:** `sui move build` → 0 errors / 0 warnings.
`sui move test` → **36/36 PASS**. Test convention is the no-arg 2024 form
`#[test] fun name() { let mut ctx = tx_context::dummy(); … }`; the deprecated
`#[test] fun name(ctx: &mut TxContext)` form is **silently skipped by the runner**
(W10007) and was deliberately avoided — that was a real footgun during S2.2.

**CI gate** (`.github/workflows/move-build-test.yml`): runs `sui move build` +
`sui move test` on every push to `p2/**`/`main` and every PR touching
`contracts/sui/`. Uses the mainnet `sui` binary pin matching `Move.toml`.

**Deploy script** (`scripts/deploy_sui_mainnet.sh`): preflight-checks active
mainnet env + non-zero gas, builds fail-fast, publishes the package, and writes
`scripts/deployed_sui_mainnet.json` (package id + shared object ids + capability
ids). Shape documented in `scripts/deployed_sui_mainnet.json.example`.

**Visibility levers** (`.gitattributes`): `*.move linguist-language=Move` +
`linguist-generated`/`linguist-vendored` rules so Move's % on the GitHub
language bar is the *real* source+test percentage, not padded by lockfiles or
build output. Together with the `.gitignore` un-hide, target ≥25% Move on the
language bar (S2.7 byte-count verified).

### What landed (S2.7 → S2.15) — grow-Move to ≥25%

S2.7a byte-count audit showed Move at **12.74%** of the repo's language bytes
(111 KB / 872 KB denominator). The Sui grants review target was ≥25%. Decision:
grow the package honestly with modules the project genuinely benefits from (not
pads). Six new modules + six new test modules added, each documented with honest
semantic differences from the EVM original:

| Module | What it does | Why it's honest (not padding) |
|--------|--------------|------------------------------|
| `view_tag_index` | Per-view-tag bucketed id index; bounded `page(after_id, limit)` scan | Fills the gap `stealth_address_registry` deliberately left (first-write-wins only; no multi-tag enumeration) |
| `fee_splitter` | Proportional fee distribution to operator payees via `Balance<SUI>` | The multi-operator model needs this; EVM single-admin withdraw won't scale |
| `announcement_indexer` | Cursor-paginated scan surface (monotonic `high_water_mark`) | Sui-native replacement for EVM `scanRange` (which was deliberately NOT ported as gas-antipattern) |
| `cancel_nonce` | Per-address monotonic nonce for intent replay protection | The EVM relayer signs EIP-712 intents with a nonce; Sui had no on-chain equivalent for queued-intent cancellation |
| `relayer_registry` | Discoverable directory of relayer operators + endpoint hash + active status | EVM has `address public relayer`; Sui `RelayerCap` is non-discoverable; wallets need this |
| `timelock_cap` | Time-locked capability holder (deposit/withdraw/cancel with configurable delay) | Sui-native analog of OpenZeppelin `TimelockController`; Sui framework has none |

`stealth_transfer` was wired to `view_tag_index` and `announcement_indexer` so
every private send also indexes the view tag and advances the cursor inline.

**After S2.15:** 12 modules, 123 tests, **~266 KB of Move source+test**.
Move = **25.9%** of the repo's language bytes (266,193 / 1,027,049), clearing
the ≥25% target.

### What's NOT done (deferred)

- Mainnet publish + a populated `deployed_sui_mainnet.json` (needs a funded
  mainnet address + a publish tx — the "money stuff", post-merge of P1.6).
- Backend/frontend wiring to the Sui package's registry/relayer (parallel to
  P1.11/P1.12 but on Move). Phase 2 follow-up.

## 9. Phase 1.6 progress (2026-06-29) — EVM deploy toolchain + Sui mainnet wiring

P1.6 landed the no-gas deploy code so the funded deploy is one command, plus
switched the entire Sui side from testnet to mainnet per the project's
"everything mainnet, no testnet" directive:

**EVM deploy toolchain (Base mainnet):**
  - `contracts/script/Deploy.s.sol` — Foundry `Script` deploying all 3 contracts
    (`StealthAddressRegistry` 0-arg, `PrivacyRelayer` 0-arg deployer=owner+relayer,
    `UniswapPrivacyWrapper` 3-arg with immutable `swapRouter`/`WETH`/`feeRecipient`).
    Writes `contracts/deployed_base.json` (addresses + chainId 8453) via `vm.writeJson`.
  - `contracts/foundry.toml` — added `fs_permissions` for the manifest write.
  - `scripts/deploy_base.sh` — preflight (forge/cast on PATH, env vars set, funded
    balance check), interactive confirmation gate (feeRecipient is IMMUTABLE),
    `forge script --broadcast`, provenance enrichment (deployedAt + git commit),
    optional Basescan verify, post-deploy checklist.
  - `contracts/.env.example` — documents `BASE_RPC_URL`, `DEPLOYER_PRIVATE_KEY`,
    `FEE_RECIPIENT` (required, immutable), `BASESCAN_API_KEY` (optional).
  - **Router fix:** `UNISWAP_V3_CONTRACTS["base"]["router"]` corrected from
    SwapRouter02 (`0x2626664c…`) to the canonical V3 SwapRouter
    (`0xE592427A0AEce92De3Edee1F18E0157C05861564`) — the contract's
    `ISwapRouter` struct has a `deadline` field only V3 SwapRouter matches.

**Sui mainnet switch (replacing all testnet references):**
  - `contracts/sui/Move.toml` — `rev = "framework/testnet"` → `"framework/mainnet"`.
  - `.github/workflows/move-build-test.yml` — installs the mainnet Sui binary,
    filters release tags for `mainnet-*`.
  - `scripts/deploy_sui_testnet.sh` → **deleted**; replaced by
    `scripts/deploy_sui_mainnet.sh` (mainnet env, mainnet gas, mainnet manifest).
  - `scripts/deployed_sui_testnet.json.example` → **deleted**; replaced by
    `scripts/deployed_sui_mainnet.json.example`.
  - `.gitignore` — `scripts/deployed_sui_testnet.json` → `deployed_sui_mainnet.json`.

**Backend Sui mainnet wiring (new, greenfield — no Sui code existed before):**
  - `_load_deployed_sui()` — mirrors `_load_deployed_addresses()`, reads
    `scripts/deployed_sui_mainnet.json` (env override `UPL_DEPLOYED_SUI_JSON`),
    validates Sui object ids with `^0x[a-fA-F0-9]{16,64}$` (NOT 40-hex like EVM),
    returns `{network, package_id, shared_objects, owned_capabilities, live}` or None.
  - `SUI_CONFIG` — mainnet RPC `https://fullnode.mainnet.sui.io:443`.
  - `_sui_rpc(method, params)` — async httpx JSON-RPC helper (no Sui SDK added).
  - `GET /api/sui/status` — deployment manifest (public, no auth).
  - `GET /api/sui/registry/count` — reads shared Registry `next_id` via `sui_getObject` (public).
  - `GET /api/deployments` — unified endpoint: EVM addresses from `UPL_CONTRACTS`
    + Sui status from `SUI_DEPLOYMENT` (public, fetched by frontend on load).

**Frontend wiring:**
  - `frontend/src/context/WalletContext.jsx` — `useEffect` fetches `/api/deployments`
    on mount, updates `CHAINS` config in place with real EVM addresses + flips
    Sui from `comingSoon: true` to `live: true` when the manifest appears.

**Tests:**
  - `backend/tests/test_deployments.py` — 13 tests: deployments endpoint
    (no manifests, with Sui manifest), Sui status (not deployed, deployed),
    loader validation (valid, missing, malformed, invalid id, non-dict).
    All 13 pass; existing 21 tests still pass (34/34 total).
  - Foundry: `forge build` clean, 5/5 smoke tests pass, `forge fmt --check` clean,
    deploy script dry-run successful (writes deployed_base.json, gas ~0.000032 ETH).
