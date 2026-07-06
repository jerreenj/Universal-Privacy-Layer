# Universal Privacy Layer — Project Plan

**Live:** [privacycloak.in](https://privacycloak.in) · **Repo:** github.com/jerreenj/Universal-Privacy-Layer
**Last updated:** 2026-07-06 (post Base-chain completion, NativePrivateSwap shipped + shipped-E2E smoke)

---

## TL;DR

- **Base customer pilot (the active focus):** COMPLETE + LIVE + E2E green. Send / Receive / Swap / PrivacyPool / History all wired through to contracts; BaseScan hides the right things.
- **Sui:** mainnet at parity.
- **Solana:** devnet-ready, one-shot mainnet wired + triple-guarded. ⏸ pending ~3 SOL rent.
- Cost of the round that finished the Base chain: ~0.00002 ETH (~$0.06) total — Native vault deploy + E2E smoke.

---

## Overall progress

```
P0  Security + cleanup              ████████████████ 100% ✅ DONE
P1  EVM contracts on Base           ████████████████ 100% ✅ DONE
P2  Sui mainnet publish + wiring    ████████████████ 100% ✅ DONE
P2.9 Sui/Base parity                ████████████████ 100% ✅ DONE
P2.9.7 Base atomic relay+announce   ████████████████ 100% ✅ DONE
P2.10 Solana (SVM) parity           ███████████░░░░░  72% 🔒 PAUSED — code + local proof + devnet path + guarded mainnet; needs ~3 SOL
P3  Real ZK (Privacy Pool, Path B)  ████████████████ 100% ✅ DONE
P4  Pools + DeFi privacy            ██████░░░░░░░░░░  42% 🟡 P4.1 + P4.2 ✅ + NativePrivateSwap ✅ LIVE; P4.3–4.5 ⏸
```

---

## Base chain — what's done (the part that matters right now)

| Feature | On-chain artefact | Status |
|---|---|---|
| **Send** | `PrivacyRelayer.relayAndAnnounce` atomic ETH transfer + announcement | ✅ LIVE (`0xCea5…1C42`), 2 relays proven on Base |
| **Receive** | `StealthAddressRegistry` + Scanner reads it (5 EVM + 2 SVM chains) | ✅ LIVE (`0x05077…0c9`) |
| **Swap (Core tile)** | `NativePrivateSwap` in-house vault — ETH in, USDC out, no third-party router | ✅ LIVE (`0x582c57…d09`), rate 3000 USDC/ETH, 0.5 USDC reserve, 5 bps fee |
| **Swap (PrivateDeFi tile)** | `AerodromePrivacyWrapper` (`0xe896…646`) + `UniswapPrivacyWrapper` (`0x9C30…362`) — opt-in 3rd-party | ✅ LIVE |
| **PrivacyPool** | 3 denominations (0.01 / 0.1 / 1 ETH), Poseidon Merkle depth 20, snarkjs Groth16 in-browser | ✅ LIVE (`0x3F0b…9C`) + Groth16Verifier (`0x838b…679`) |
| **History** | Sealed records (wallet-derived AES-256-GCM) — backend stores ciphertext only | ✅ LIVE |

### Privacy hiding — what is hidden ✅

| Vector | Hidden? | How |
|---|---|---|
| Customer's EOA as tx sender | ✅ | Send: relayer pays; Swap: wrapper/vault is msg.sender |
| Recipient identity | ✅ | One-time EIP-5564 stealth address |
| Memo / encrypted body | ✅ | Sender-side wallet encrypts; only recipient's view-key decrypts |
| Deposit ↔ withdraw link | ✅ | Groth16 proof over Poseidon Merkle root |
| History row contents (across rows) | ✅ | AES-256-GCM seal with per-record random IV + wallet-derived key |

### Privacy hiding — what is NOT hidden (be honest)

| Vector | Visible | Why and what we do about it |
|---|---|---|
| Customer's EOA calls the swap wrapper/vault | visible on BaseScan | Inherent — msg.sender is always the signer. Mitigation: the **recipient** is the stealth address, so the swap is unlinked from the recipient's real spending address. |
| ETH / USDC amounts | visible | Tied to tx payload. Cannot hide without ZK-rollup. Out of scope. |
| History table column metadata (tx_hash, from EOA, amount_wei, timestamp) | visible to **backend** | Required so a customer can search their own history. K1-K7 closer: the `client: "metadata"` envelope fields stay ciphertext; only the search-by-EOA column is plaintext. Trade-off, not a bug. |
| PrivacyPool ceremony | self-run 1-party | Acceptable at launch; MPC upgrade is on the deferred list. |
| Browser proving time | 5-20 s `snarkjs` WASM | UX shows "generating proof…"; backend-prover is a future acceleration. |

### What is left — honest gaps (Base chain customer pilot)

| # | Gap | Why it's left | Cost to close |
|---|---|---|---|
| 1 | NativePrivateSwap vault reserve | 0.5 USDC seeded for the pilot; need owner-funded top-ups for production scale | ~0 (deployer USDC) |
| 2 | NativePrivateSwap rate is owner-set fixed | No oracle; rate set on demand by ops | ~0 |
| 3 | PrivacyPool browser proving time | snarkjs WASM is unavoidable for client ZK; backend-prover is a future optimization | engineering |
| 4 | PrivacyPool ceremony trust assumption | MPC ceremony is the production-grade upgrade | ~hard |
| 5 | Backend-assisted steps (`/api/stealth/generate`, `/api/announcements`, `/api/zk-pool/*` witness generation) | Privacy pool MUST use backend for witness inputs (Merkle path computation); stealth generation could move to wallet (~engineering) | either |
| 6 | Single EOA pays all relayer/swap gas | Production wants a hot-wallet queue with nonce management (P4.4) | engineering |

### E2E verification (Base)

- `forge test` → **78 PASS / 0 failed / 1 skipped** (29 = NativePrivateSwap, 13 = AerodromePrivacyWrapper, 14 = Uniswap smoke, 11 = PrivacyPool mock, 4 = real Groth16 E2E, 3 = PoseidonT3, 9 = PrivacyRelayer, 5 = StealthAddressRegistry)
- `forge fmt --check` → clean
- `pytest backend/tests/test_deployments.py backend/tests/test_auth_health.py backend/tests/test_payments.py` → **all green** (lock-in test confirms `native_swap_wrapper = 0x582c57a7…9062` is surfaced through `/api/deployments`)
- `parsers @babel/parser` on `SwapContent.jsx`, `Dashboard.jsx`, `AerodromePrivateSwap.jsx` → **all parse clean**
- **E2E smoke on live vault:** `SmokeNative.s.sol` broadcast `1e12 wei` → recipient USDC delta `+2,998 µUSDC == vault.quote(1e12)`. Tx `0x73a67e9595f99ca77b9b82044c1a68649f81346f05a111814c626f4b976bfbb4`
- **CI:** Foundry + Backend Tests + Deploy-to-Azure all green on `c598639` (HEAD)

### Live on-chain proof

- NativePrivateSwap deploy: [tx `0x68bd7107…1407`](https://basescan.org/tx/0x68bd7107439f108b1e846e9c996d8f2eb78692031425ae313ddc20bd4f4c1407)
- NativePrivateSwap live E2E smoke: [tx `0x73a67e95…fbb4`](https://basescan.org/tx/0x73a67e9595f99ca77b9b82044c1a68649f81346f05a111814c626f4b976bfbb4)

---

## Live addresses

### EVM (Base mainnet, chainId 8453)

| Contract | Address | Note |
|---|---|---|
| PrivacyRelayer (P2.9.7 atomic) | `0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42` | atomic `relayAndAnnounce` |
| StealthAddressRegistry (legacy) | `0x05077cB4c4214b89dD35F949b587d31e79b3B0c9` | superseded; P4.1 active |
| StealthAddressRegistry (P4.1) | `0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1` | active |
| Groth16Verifier (P4.1) | `0x838b7c20b1a97cAA6379542d03983b4571275679` | snarkjs-generated |
| PrivacyPool (P4.1, multi-denom) | `0x3F0b23Aca0624981a503e8f042db2F3884D0C89C` | 3 denoms: 0.01 / 0.1 / 1 ETH |
| UniswapPrivacyWrapper (P4.1) | `0x9C30cdCd73347BF18A5bD424C37E5714e2606362` | opt-in 3rd-party |
| AerodromePrivacyWrapper (P4.2 hotfix) | `0xe896e6f51af137c32db7eb4e3b2de795d392a646` | 4-field Route + factory |
| **NativePrivateSwap (in-house vault)** | **`0x582c57a7ba6e7758e75dc5334a5e8ff096515d09`** | **Core Private Swap tile** |

**Deployer / Owner / Relayer / FeeRecipient:** `0x3f44A6451439673D95082A1337045a25ec275394`

### Sui (mainnet)

| Object | ID |
|---|---|
| Package (v4) | `0x3f010dae8e51468176edd259180c4fae72788f9fc42db127194f6b42c9ca9300` |
| Registry (shared) | `0x7b62abe30dbc0fd63432ef3b51b506d8a51cce467634ce1854b1941817454b13` |
| RelayerState (shared) | `0x9ec03995c0dad3522657d731965b29b1086213814048b5df9046c50a13441c34` |
| ViewTagIndex (shared) | `0xe272ae2fe3c7738049be55125539ad7321699301fb1882b1508720a24f4ec904` |
| AnnouncementIndexer (shared) | `0x078bdd9628b80db21698a2ea376556daa4c7dce27b117744d128affe8d1ccd10` |

### Solana

| State | Value |
|---|---|
| Program ID | `E4yQzfbV8dpf1DH33u3ESNm3wvX2UYpQRnb3NVnAtT7x` |
| Network | devnet — to flip to mainnet, run `scripts/flip_sol_to_mainnet.sh` (guarded; needs ≥3 SOL wallet) |

---

## Pipelines (CI/CD)

| Workflow | Trigger | Status |
|---|---|---|
| `foundry-build-test.yml` | push to `main` touching `contracts/**` | ✅ pinned to stable Foundry v1.7.1; `forge build + test + fmt` |
| `backend-tests.yml` | push to `main` touching `backend/**` | ✅ `pytest` against `test_auth_health.py test_payments.py test_deployments.py` |
| `deploy-azure.yml` | push to `main` | ✅ Docker → `app-privacycloak.grayplant-b87273e4.eastus.azurecontainerapps.io` |
| `move-build-test.yml` | push to `main` touching `contracts/sui/**` | ✅ Sui Move build + test on `framework/mainnet` |
| `solana-build-test.yml` | push to `main` touching `contracts/solana/**` | ✅ Rust + Anchor install + `anchor build` |

---

## Deferred (no blocker without funding; not on the Base pilot critical path)

| Item | Reason |
|---|---|
| P4.3 cross-chain private routing (Base→Arb/Op/Polygon) | Awaiting second-chain liquidity |
| P4.4 dedicated relayer hot-wallet + nonce/queue hardening | Production hardening; pilot-scale working |
| P4.5 production monitoring + alerting | Post-pilot |
| Solana mainnet deploy | Needs ~3 SOL rent (~$400-700, mostly reclaimable) |
| MPC Powers-of-Tau ceremony upgrade | PrivacyPool is sound under self-run ceremony; MPC is the future trust upgrade |
| PrivacyPool in-browser WASM acceleration / backend prover | ~engineering |
| Wallet-derivable stealth generation (move `/api/stealth/generate` to client) | ~engineering |
| Aztec / Railgun / Tornado-cash-class multi-asset pool | Out of project scope |
