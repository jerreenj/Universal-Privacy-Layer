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
P2  Sui mainnet publish + wiring    ████████████████ 100% ✅ DONE
P2.9 Sui parity with Base (relay+scan+receipts) ████████████████ 100% ✅ DONE
P3  Real ZK (Circom + verifier)     ░░░░░░░░░░░░░░░░   0% ⏸️ not started
P4  Privacy pools + DeFi privacy    ░░░░░░░░░░░░░░░░   0% ⏸️ not started
```

**Last updated:** 2026-06-30 — P2.9 complete (Sui brought to parity with Base: real
relayed_send with Coin<SUI> value transfer proven on mainnet, scan + receipts wired)

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

## P2 — Sui Mainnet Publish + Wiring ✅ DONE

### Sub-task Progress

```
P2.1  Move package (14 modules, 126 tests)    ████████████████ 100% ✅
P2.2  Move.toml → framework/mainnet           ████████████████ 100% ✅
P2.3  CI gate (mainnet Sui binary)            ████████████████ 100% ✅
P2.4  Deploy script (deploy_sui_mainnet.sh)   ████████████████ 100% ✅
P2.5  Backend Sui loader + /api/sui/*          ████████████████ 100% ✅
P2.6  Frontend Sui liveness fetch             ████████████████ 100% ✅
P2.7  PUBLISH to Sui mainnet (real SUI gas)   ████████████████ 100% ✅
P2.8  Sui relay + frontend components         ████████████████ 100% ✅
```

### Deployed Objects (Sui mainnet)

| Object | ID |
|--------|-----|
| Package (v3) | `0xc930c83d82b6547004f20d9336b7fbfd390116984d9669fe5de56eb4a812f991` |
| Package (original) | `0xb9fe4d78d216e98b6229e97f93972cb7c3493d8d9f123880f781ab920c66db50` |
| Registry (shared) | `0x7b62abe30dbc0fd63432ef3b51b506d8a51cce467634ce1854b1941817454b13` |
| AnnouncementIndexer (shared) | `0x078bdd9628b80db21698a2ea376556daa4c7dce27b117744d128affe8d1ccd10` |
| UpgradeCap | `0xd4b4aff0fda905c50accccccbafa0a1106b35c012a98124568dea32e00e034bd` |
| AdminCap | `0x15e9e5174b708bef3644e851de907e4f55f6d088058c34d143888fb386b2556c` |
| RelayerCap | `0xbc0898789926a7bf0436e3a5095ddbe71ec09658af1525a0df55ea9ff07ed416` |
| ReceiptCap | `0x7394b019a70ba284fd7846c171ea787181305a3f16d52b29d866d28cad3f03f5` |

### What was proven on-chain

- **Package published** to Sui mainnet (14 modules, 126/126 tests pass on `framework/mainnet`)
- **1 test announce** submitted via `announce_entry` — registry `next_id: 1`
- **Package upgraded to v3** (added `announce_entry` CLI-friendly function)
- **Sui relayer script** (`scripts/sui_relayer.py`) builds + submits announce transactions
- **Backend `/api/sui/relay/submit`** endpoint calls the Sui CLI to submit announces
- **Frontend `SuiStealthSend.jsx`** component: generate ephemeral key → submit announce → show tx confirmation
- **Gas spent**: ~0.6 SUI total (publish + 2 upgrades + test announce)

---

## P2.9 — Sui Parity with Base (relay + scan + receipts) ✅ DONE

P2 shipped the Sui Move package + an announce-only relay. A parity audit found
Sui was NOT at Base's level: the relay did no value transfer, there was no
receive/scan surface, and on-chain receipts were unwired. P2.9 closes those gaps
so Sui matches Base before Phase 4.

### Sub-task Progress

```
P2.9.1 Manifest reconciliation       ████████████████ 100% ✅
P2.9.2 Package v4 (entry wrappers)   ████████████████ 100% ✅
P2.9.3 Real relayed_send on mainnet  ████████████████ 100% ✅
P2.9.4 Sui relay backend             ████████████████ 100% ✅
P2.9.5 Sui scan + receipts endpoints ████████████████ 100% ✅
P2.9.6 Frontend (send + scan + receipts) █████████████ 100% ✅
```

### What was done

**P2.9.1 — Manifest reconciliation.** The P2.7 publish manifest omitted 6 shared
objects + 5 owned capabilities (it only recorded registry + announcement_indexer
+ the 4 original caps). Recovered all 10 shared objects + 10 caps from the
publish-tx `objectChanges` (tx `F6DxHWHf...`) via `sui_getTransactionBlock`, and
added them to `scripts/deployed_sui_mainnet.json`. Crucially this surfaced
`relayer_state` (`0x9ec039...`) and `view_tag_index` (`0xe272ae...`) — both
required by `stealth_transfer::relayed_send` but missing from the manifest. The
backend `_load_deployed_sui()` now surfaces ALL shared objects (was only
registry + relayer_state) and accepts both flat-string and nested per-module
capability shapes.

**P2.9.2 — Package v4 (entry wrappers).** `stealth_transfer::relayed_send` is a
`public fun` (composed inside other PTBs), but the Sui CLI `ptb --move-call`
parser has no `vector<u8>` literal syntax — so it was unreachable from the CLI.
Added `public entry fun relayed_send_entry` + `direct_send_entry` (ctx as last
arg, auto-injected) so `sui client call` (which accepts base64 `vector<u8>` args)
can invoke them — the same pattern as `announce_entry` in v3. Package upgraded
to **v4** on mainnet (`0x3f010d...`, upgrade tx `GWN9Qhs...`). 128/128 Move
tests pass (was 126; +2 entry-wrapper delegation tests).

**P2.9.3 — Real relayed_send on mainnet.** Proved a real private send with
`Coin<SUI>` value transfer (the Sui analog of Base's 2 ETH relays): split a gas
coin (10000 MIST) → called `relayed_send_entry` → atomic announce + index +
cursor-advance + relay + receipt-mint. On-chain proof (tx `HSqpd1...`):
Registry `next_id` 1→2, RelayerState `total_relayed` 0→10000, ViewTagIndex
`total_indexed` 0→1. Relayed to the publisher's own address so the test funds
returned; net gas ~0.0000086 SUI.

**P2.9.4 — Sui relay backend.** Rewrote `POST /api/sui/relay/submit` from
announce-only to a real relayed send: resolves caps + shared objects from the
manifest, splits a gas coin for `amount_mist`, calls `relayed_send_entry`,
returns tx digest + execution status + new announcement count + total_relayed.
`scripts/sui_relayer.py` gained a `relay-send` subcommand (split-coin → call)
mirroring the Base relayer's value-transfer path.

**P2.9.5 — Sui scan + receipts endpoints.** `GET /api/sui/announcements` reads
the live id range + count from the shared Registry (the recipient scanner
surface — public). `GET /api/sui/receipts/{owner}` lists
`privacy_receipt::PrivacyReceipt` objects owned by an address via
`suix_getOwnedObjects` (auth-gated — reveals recipient addresses).

**P2.9.6 — Frontend.** Upgraded `SuiStealthSend.jsx` from announce-only to a
real relayed send (recipient + amount + ephemeral key + view tag → relayed_send).
Added `SuiScanner.jsx` (announcements scanner) + `SuiReceipts.jsx` (receipt
viewer); both wired into the Dashboard sidebar. All 4 files parse clean;
lucide-react icons verified present.

### Deployed Objects (Sui mainnet, v4)

| Object | ID |
|--------|-----|
| Package (v4) | `0x3f010dae8e51468176edd259180c4fae72788f9fc42db127194f6b42c9ca9300` |
| Package (v3, previous) | `0xc930c83d82b6547004f20d9336b7fbfd390116984d9669fe5de56eb4a812f991` |
| Registry (shared) | `0x7b62abe30dbc0fd63432ef3b51b506d8a51cce467634ce1854b1941817454b13` |
| RelayerState (shared) | `0x9ec03995c0dad3522657d731965b29b1086213814048b5df9046c50a13441c34` |
| ViewTagIndex (shared) | `0xe272ae2fe3c7738049be55125539ad7321699301fb1882b1508720a24f4ec904` |
| AnnouncementIndexer (shared) | `0x078bdd9628b80db21698a2ea376556daa4c7dce27b117744d128affe8d1ccd10` |
| UpgradeCap | `0xd4b4aff0fda905c50accccccbafa0a1106b35c012a98124568dea32e00e034bd` |
| RelayerCap | `0xbc0898789926a7bf0436e3a5095ddbe71ec09658af1525a0df55ea9ff07ed416` |
| ReceiptCap | `0x7394b019a70ba284fd7846c171ea787181305a3f16d52b29d866d28cad3f03f5` |
| privacy_relayer::AdminCap | `0xb65170d5f79f56f04bf61bb88b1a05e01fa44825bd0e22225f32cc54c9b9b59f` |

### Gas / funds

- Started: ~3.85 SUI. Spent: ~0.20 SUI (v4 upgrade 0.185 + relay/split gas ~0.01).
- Remaining: ~3.65 SUI (kept safe — >94% preserved).
- Test relay amount (10000 MIST) returned to the publisher wallet (relayed to self).

### Parity status (Sui vs Base)

| Capability | Base (EVM) | Sui (Move) |
|-----------|-----------|-----------|
| Stealth announcements | ✅ on-chain | ✅ on-chain (Registry) |
| Relayed private send w/ value | ✅ 2 ETH relays | ✅ 1 SUI relay (P2.9.3) |
| Receive/scan surface | ✅ scanRange | ✅ /api/sui/announcements + scanner |
| Encrypted receipts | ✅ event log | ✅ PrivacyReceipt objects + viewer |
| Atomic compose (announce+relay+receipt) | ❌ (off-chain relayer stitches) | ✅ one PTB (Move advantage) |

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
| Package (v4) | `0x3f010dae8e51468176edd259180c4fae72788f9fc42db127194f6b42c9ca9300` |
| Package (v3, previous) | `0xc930c83d82b6547004f20d9336b7fbfd390116984d9669fe5de56eb4a812f991` |
| Registry (shared) | `0x7b62abe30dbc0fd63432ef3b51b506d8a51cce467634ce1854b1941817454b13` |
| RelayerState (shared) | `0x9ec03995c0dad3522657d731965b29b1086213814048b5df9046c50a13441c34` |
| ViewTagIndex (shared) | `0xe272ae2fe3c7738049be55125539ad7321699301fb1882b1508720a24f4ec904` |
| AnnouncementIndexer (shared) | `0x078bdd9628b80db21698a2ea376556daa4c7dce27b117744d128affe8d1ccd10` |
| UpgradeCap | `0xd4b4aff0fda905c50accccccbafa0a1106b35c012a98124568dea32e00e034bd` |
| privacy_relayer::AdminCap | `0xb65170d5f79f56f04bf61bb88b1a05e01fa44825bd0e22225f32cc54c9b9b59f` |
| RelayerCap | `0xbc0898789926a7bf0436e3a5095ddbe71ec09658af1525a0df55ea9ff07ed416` |
| ReceiptCap | `0x7394b019a70ba284fd7846c171ea787181305a3f16d52b29d866d28cad3f03f5` |

---

*This file is updated after every milestone. Last update: 2026-06-30 (P2.9 complete — Sui at parity with Base).*
