# Universal Privacy Layer — Project Plan & Progress

> This is the living roadmap for the Universal Privacy Layer ("PrivacyCloak").
> It lives at the repo root so anyone on the team can see exactly where we are.
> Updated after every milestone.

**Live site:** [privacycloak.in](https://privacycloak.in)
**Repo:** [github.com/jerreenj/Universal-Privacy-Layer](https://github.com/jerreenj/Universal-Privacy-Layer)

---

## Overall Progress

```
P0  Security + cleanup              ████████████████ 100% ✅ DONE
P1  EVM contracts on Base           ████████████████ 100% ✅ DONE
P2  Sui mainnet publish + wiring    ████████░░░░░░░░  50% 🔄 toolchain done, deploy pending
P3  Real ZK (Circom + verifier)     ░░░░░░░░░░░░░░░░   0% ⏸️ not started
P4  Privacy pools + DeFi privacy    ░░░░░░░░░░░░░░░░   0% ⏸️ not started
```

**Last updated:** 2026-06-29 — P1 fully complete (all 13 sub-tasks, deployed + tested on Base mainnet)

---

## P0 — Security & Repo Cleanup ✅ DONE

| # | Task | Status |
|---|------|--------|
| P0.1 | Scrub leaked credentials, rotate passwords, rewrite git history | ✅ Done |
| P0.2 | Fix .gitignore corruption, trim bloated deps | ✅ Done |
| P0.3 | Honest-up README (soften un-backed crypto claims) | ✅ Done |
| P0.4 | Backend test suite (mocked DB, no live Mongo) + CI | ✅ Done |

---

## P1 — EVM Contracts on Base Mainnet ✅ DONE

All 13 sub-tasks complete. Contracts deployed, tested with real gas, frontend wired end-to-end.

### Deployed Contracts (Base mainnet, chainId 8453)

| Contract | Address | Basescan |
|----------|---------|----------|
| PrivacyRelayer | `0x994F6Ce29B073f82317E8F175D8aac15C2671365` | [view](https://basescan.org/address/0x994F6Ce29B073f82317E8F175D8aac15C2671365) |
| StealthAddressRegistry | `0x05077cB4c4214b89dD35F949b587d31e79b3B0c9` | [view](https://basescan.org/address/0x05077cB4c4214b89dD35F949b587d31e79b3B0c9) |
| UniswapPrivacyWrapper | `0x01A7EB9acb55B80254609dCB8112f1cd65D67c8F` | [view](https://basescan.org/address/0x01A7EB9acb55B80254609dCB8112f1cd65D67c8F) |

**Deployer/Owner/Relayer/FeeRecipient:** `0x3f44A6451439673D95082A1337045a25ec275394`

### Sub-task Progress

```
P1.1  Relayer reconciliation         ████████████████ 100% ✅
P1.2  Registry bug fix               ████████████████ 100% ✅
P1.3  ZK verifier removal            ████████████████ 100% ✅
P1.4  Foundry scaffold + tests       ████████████████ 100% ✅
P1.5  deployed_base.json loader      ████████████████ 100% ✅
P1.6  Deploy toolchain (code)        ████████████████ 100% ✅
P1.7  Wrapper backend wiring         ████████████████ 100% ✅
P1.8  Address loader                 ████████████████ 100% ✅
P1.9  DEPLOY to Base mainnet         ████████████████ 100% ✅
P1.10 Relayer service                ████████████████ 100% ✅
P1.11 On-chain announcements         ████████████████ 100% ✅
P1.12 Frontend E2E wiring            ████████████████ 100% ✅
P1.13 Private swap test              ████████████████ 100% ✅
```

### What was proven on-chain

- **2 private relays executed** — totalRelayed: 0.0001999 ETH
- **1 announcement recorded** on StealthAddressRegistry
- **Relayer service** validates EIP-712 signature → calls `relay()` → calls `announce()`
- **Frontend E2E**: prepare intent → sign off-chain → submit to relayer → on-chain tx confirmation with Basescan links
- **UniswapPrivacyWrapper**: contract logic verified (fee skim + WETH wrap + approve all work). Swap reverts because no Uniswap V3 WETH/USDC pool exists on Base — Base's primary DEX is Aerodrome. Adding an Aerodrome router path is Phase 4 scope.

### Key files

| File | Purpose |
|------|---------|
| `contracts/src/*.sol` | 3 production contracts (Foundry, solc 0.8.20, OZ v5) |
| `contracts/script/Deploy.s.sol` | Foundry deploy script → writes deployed_base.json |
| `scripts/deploy_base.sh` | Production deploy wrapper (preflight, confirm, broadcast, verify) |
| `scripts/relayer.py` | Off-chain relayer service (EIP-712 validate → relay() + announce()) |
| `backend/server.py` | `/api/relayer/prepare-tx`, `/api/relayer/submit`, `/api/relayer/stats`, `/api/deployments` |
| `frontend/src/components/features/OnChainRelayer.jsx` | Full E2E UI: prepare → sign → submit → confirmation |

---

## P2 — Sui Mainnet Publish + Wiring 🔄 50%

### Sub-task Progress

```
P2.1  Move package (12 modules, 123 tests)    ████████████████ 100% ✅
P2.2  Move.toml → framework/mainnet           ████████████████ 100% ✅
P2.3  CI gate (mainnet Sui binary)            ████████████████ 100% ✅
P2.4  Deploy script (deploy_sui_mainnet.sh)   ████████████████ 100% ✅
P2.5  Backend Sui loader + /api/sui/*          ████████████████ 100% ✅
P2.6  Frontend Sui liveness fetch             ████████████████ 100% ✅
P2.7  PUBLISH to Sui mainnet (real SUI gas)   ░░░░░░░░░░░░░░░░   0% ⏸️ pending funding
P2.8  Wire Sui registry reads to frontend     ░░░░░░░░░░░░░░░░   0% blocked on P2.7
```

### What's done

- 12-module Move package `upl` builds + tests against `framework/mainnet` (CI green)
- `scripts/deploy_sui_mainnet.sh` ready to publish (preflight, build, publish, write manifest)
- Backend `_load_deployed_sui()` reads `deployed_sui_mainnet.json` + serves `/api/sui/status`, `/api/sui/registry/count`, `/api/deployments`
- Frontend fetches `/api/deployments` on load and flips Sui from "coming soon" to live

### What's pending

- **P2.7**: Fund a Sui mainnet wallet with ~10 SUI, run `bash scripts/deploy_sui_mainnet.sh`
- **P2.8**: After publish, frontend auto-shows Sui as live (no code change needed)

---

## P3 — Real ZK (Circom + Trusted Setup + Verifier) ⏸️ Not Started

| # | Task | Difficulty |
|---|------|-----------|
| P3.1 | Write Circom circuits for stealth address proof | Hard |
| P3.2 | Trusted setup ceremony (Powers of Tau) | Hard |
| P3.3 | Generate Groth16 proving + verification keys | Medium |
| P3.4 | Deploy real Groth16Verifier.sol on Base | Medium |
| P3.5 | Wire backend `/api/zkp/verify-onchain` to real verifier | Medium |
| P3.6 | Frontend ZK proof generation + submission | Hard |

**Note:** The unsound `Groth16Verifier.sol` (DELTA==GAMMA bug) was removed in P1.3. On-chain ZK verification endpoints return HTTP 501 ("deferred to Phase 3") until this is built.

---

## P4 — Privacy Pools + Advanced DeFi Privacy ⏸️ Not Started

| # | Task | Difficulty |
|---|------|-----------|
| P4.1 | Privacy pool contract (deposits + withdrawals with ZK nullifiers) | Hard |
| P4.2 | Aerodrome router integration (Base's primary DEX, not Uniswap V3) | Medium |
| P4.3 | Cross-chain private routing (Base → Arbitrum → Polygon) | Hard |
| P4.4 | Relayer service hardening (dedicated hot wallet, nonce management, queue) | Medium |
| P4.5 | Production monitoring + alerting | Medium |

**P1.13 finding:** Uniswap V3 has no WETH/USDC pool on Base. The `UniswapPrivacyWrapper` contract is correct but needs an Aerodrome V2 router path to work on Base. This is Phase 4 scope.

---

## CI/CD Pipeline

| Workflow | Trigger | Status |
|----------|---------|--------|
| `deploy-azure.yml` | Push to `main` | ✅ Builds Docker → deploys to Azure Container Apps |
| `backend-tests.yml` | Push to `main`/`dev` touching `backend/**` | ✅ pytest (mocked DB) |
| `foundry-build-test.yml` | Push to `main` touching `contracts/**` | ✅ forge build + test + fmt |
| `move-build-test.yml` | Push to `main` touching `contracts/sui/**` | ✅ sui move build + test (mainnet framework) |

**Production:** Every push to `main` rebuilds the Docker image (frontend + backend) and updates `app-privacycloak` on Azure Container Apps. Health check gates on HTTP 200 from `/api/health`.

---

## Deployed Addresses Summary

### EVM (Base mainnet)

| Contract | Address |
|----------|---------|
| PrivacyRelayer | `0x994F6Ce29B073f82317E8F175D8aac15C2671365` |
| StealthAddressRegistry | `0x05077cB4c4214b89dD35F949b587d31e79b3B0c9` |
| UniswapPrivacyWrapper | `0x01A7EB9acb55B80254609dCB8112f1cd65D67c8F` |

### Sui (mainnet)

| Object | ID |
|--------|-----|
| Package | *pending P2.7 deploy* |
| Registry (shared) | *pending P2.7 deploy* |
| RelayerState (shared) | *pending P2.7 deploy* |
| AdminCap | *pending P2.7 deploy* |
| RelayerCap | *pending P2.7 deploy* |
| ReceiptCap | *pending P2.7 deploy* |
| UpgradeCap | *pending P2.7 deploy* |

---

*This file is updated after every milestone. Last update: 2026-06-29 (P1 complete).*
