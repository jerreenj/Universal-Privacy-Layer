# Universal Privacy Layer — Project Plan

**Live:** [privacycloak.in](https://privacycloak.in) · **Repo:** github.com/jerreenj/Universal-Privacy-Layer

**Last updated:** 2026-07-07 (post-everything-fixed;)

---

## TL;DR — what's done

- **Send**: ✅ — privacy-preserving on-chain (customer's EOA never appears; hot wallet `0x2d82E56f…` fronts in atomic `relayAndAnnounce`) — Base mainnet. Operator env auto-flipped in CI.
- **Receive**: ✅ — wallet-derive button, direct-RPC scanner (`eth_getLogs` against `StealthAddressRegistry`), no backend round-trip needed for the scan; backend helper for the meta derivation if user doesn't have a saved keystore.
- **Native Swap (Core tile)**: ✅ — `NativePrivateSwap` vault at `0x582c57a7…` (rate 1700 USDC/ETH, 6.08 USDC seeded reserve, 5 bps skim). 0 third-party AMM hop. Verified on-chain: customer tx `0x19b7fb0a…` swapped 0.0001 ETH → 169,915 µUSDC to stealth.
- **Multi-DEX Swap (PrivateDeFi)**: ✅ — Aerodrome V2 + Uniswap V3 wrappers for opt-in 3rd-party routing (Aerodrome V2 = the customer's actual market; pickers visible on the dashboard).
- **PrivacyPool**: ✅ — multi-denom (0.01 / 0.1 / 1 ETH live), Poseidon Merkle depth 20, Groth16 verifier on-chain. Browser-side snarkjs-WASM proof + server-side prover endpoint wired (M2; gated by `ZK_POOL_PROVER_ENABLED=1`).
- **Transaction History**: ✅ — every row sealed with wallet-derived AES-256-GCM; backend stores ciphertext only.
- **Sui mainnet**: ✅ at parity.
- **Solana**: 🔒 PAUSED — code + local proof + devnet + triple-guarded mainnet script (`scripts/flip_sol_to_mainnet.sh`); flipped to mainnet needs ~3 SOL.

**Money spent this round + the previous Base closer round combined = ~$11** (deployer ETH: ~0.0027 ETH ≈ $7 real gas; vault funded with ~$4 USDC; relay buffer ≈$0.30; customer-pilot demo funding 0.0022 ETH ≈ $5.50 from deployer to a fresh customer EOA carrying the demo). All non-recoverable deployer ETH ≈ $7; everything else is still operational capital (in the vault's USDC reserve, the hot-wallet relayer buffer, and the customer EOA for the demo).

---

## Progress per phase

```
P0  Security + cleanup              ████████████████ 100% ✅ DONE
P1  EVM contracts on Base           ████████████████ 100% ✅ DONE
P2  Sui mainnet publish + wiring    ████████████████ 100% ✅ DONE
P2.9 Sui/Base parity                ████████████████ 100% ✅ DONE
P2.9.7 Base atomic relay+announce   ████████████████ 100% ✅ DONE
P2.10 Solana (SVM) parity           ███████████░░░░░  72% 🔒 PAUSED — needs ~3 SOL
P3  Real ZK (Privacy Pool, Path B)  ████████████████ 100% ✅ DONE
P4  Pools + DeFi privacy            ████████████████ 100% ✅ DONE (round-1: P4.1 multi-denom + P4.2 Aerodrome + NativePrivateSwap + Backend-Prover + wallet-derive everywhere)
```

---

## Live addresses (Base mainnet, chainId 8453)

| Contract | Address | Note |
|---|---|---|
| **PrivacyRelayer (P2.9.7 atomic)** | **`0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42`** | registry wired; new hot-wallet relayer slot set |
| **PrivacyRelayer hot wallet** | **`0x2d82E56f56e4483032fEf8248c2EB75C45A68D2d`** | fronts gas for atomic `relayAndAnnounce`; key in `scripts/.relayer-hot-wallet.txt` (gitignored) |
| **StealthAddressRegistry** | **`0x05077cB4c4214b89dD35F949b587d31e79b3B0c9`** | live announcement log |
| **Groth16Verifier** | **`0x838b7c20b1a97cAA6379542d03983b4571275679`** | snarkjs-generated |
| **PrivacyPool (multi-denom)** | **`0x3F0b23Aca0624981a503e8f042db2F3884D0C89C`** | 3 denoms: 0.01 / 0.1 / 1 ETH |
| **AerodromePrivacyWrapper (P4.2 hotfix)** | **`0xe896e6f51af137c32db7eb4e3b2de795d392a646`** | 4-field Route struct + factory |
| **UniswapPrivacyWrapper** | **`0x9C30cdCd73347BF18A5bD424C37E5714e2606362`** | opt-in 3rd-party |
| **NativePrivateSwap (in-house vault)** | **`0x582c57a7ba6e7758e75dc5334a5e8ff096515d09`** | Core Private Swap tile; 1700 USDC/ETH rate; 6.08 USDC reserve |
| USDC (settlement token) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | — |

**Deployer / Owner / FeeRecipient / PoolOwner:** `0x3f44A6451439673D95082A1337045a25ec275394`

---

## Privacy hiding on BaseScan — what IS and IS NOT hidden

| Vector | Hidden? | How |
|---|---|---|
| Customer's EOA as `msg.sender` on **Send** | ✅ | atomic `relayAndAnnounce` — hot wallet fronts the tx; customer's EOA only ever signs an off-chain EIP-712 |
| Customer's EOA as `msg.sender` on **Swap (Core tile)** | ⚠️ | visible — inherent to in-house vault; mitigated by the **recipient** being a stealth EOA so the OUTPUT is unlinked from the customer's spend identity |
| Recipient identity (Send + Swap) | ✅ | EIP-5564 one-time stealth address; derived per-payment via ephemeral ECDH against wallet-derived meta (HKDF over `personal_sign`) |
| Memo / encrypted body | ✅ | AES-256-GCM wallet-derived seal; per-record random IV + salt |
| History row contents | ✅ | ciphertext envelope stored in backend; only customer's wallet can unseal |
| Deposit↔withdraw link in PrivacyPool | ✅ | Groth16 + Poseidon ZK proof; in-browser snarkjs WASM (or optional server-side via M2) |
| Announcer of stealth announcement | ✅ | PrivacyRelayer contract is the `announcer`, NOT the customer's EOA |

### What's NOT hidden (architectural reality, not bugs)

| Vector | Visible | What we do |
|---|---|---|
| ETH / USDC amounts on tx | visible | tied to tx payload; cannot hide without a ZK-rollup; out of scope |
| PrivacyPool ceremony trust assumption | self-run 1-party | Groth16 `Verifier.sol` is on-chain and sound; multi-party MPC upgrade path is documented (Gap 4 in `docs/base-pilot-closer.md`); out-of-budget for current round |

---

## What's left to make Base chain "completely done"

| # | Item | Blocker? | Effort / cost |
|---|---|---|---|
| 1 | Operator flips `RELAYER_PRIVATE_KEY` env on `app-privacycloak` to `0xbf7ddbc1042bd3b6179100debb116a871f93d35cf2426b3e69cf874e5f9d509f` | Was blocking; **fixed this round** via auto-flip step in `deploy-azure.yml` | $0 |
| 2 | Operator flips `ZK_POOL_PROVER_ENABLED=1` env on `app-privacycloak` to enable server-side Groth16 prover | Optional opt-in (browser snarkjs WASM already works) | $0 + operator build-out to upload `withdraw_final.zkey` + `withdraw_js/` artefacts to the backend image per the runbook in `Dockerfile` line ~57 |
| 3 | Customer-pilot first test: Send + Receive + Swap end-to-end | waits on operator | $0 |
| 4 | PrivacyPool deposit demo (≥0.01 ETH) | out of $1.5 envelope; pooled funds add is a $25 cycle, customer can fund themselves | $25 |
| 5 | MPC upgrade for PrivacyPool zkey (2-party contribution) | out of single-operator scope; needs an independent 2nd contributor | $0–$5 |
| 6 | Production hardening (multi-wallet queue, monitoring, rate oracle) | not blocking customer pilot; post-pilot | ~engineering time |

---

## Operational runbooks (top links)

- Customer demo flow proof on Base mainnet: [`docs/customer-demo-flow.md`](docs/customer-demo-flow.md)
- Closer-round ops (vault topups, hot wallet, ceremony upgrade path): [`docs/base-pilot-closer.md`](docs/base-pilot-closer.md)
- Privacy architecture + ceremony + trust model: [`docs/zk-architecture.md`](docs/zk-architecture.md)
- Solana pause / resume procedure: [`scripts/flip_sol_to_mainnet.sh`](scripts/flip_sol_to_mainnet.sh) (guarded; one-shot mainnet)

---

## CI/CD (all green on HEAD)

| Workflow | Trigger | Status | Pin |
|---|---|---|---|
| `foundry-build-test.yml` | push to main touching `contracts/**` | ✅ | pinned Foundry stable v1.7.1 (`+ drop --no-commit`) |
| `backend-tests.yml` | push to main touching `backend/**` | ✅ | pytest CI gate (test_deployments + test_auth_health + test_payments) |
| `deploy-azure.yml` | push to main | ✅ | Docker → app-privacycloak; auto-flips `RELAYER_PRIVATE_KEY` env from GH repo secret; health-gates on `/api/health` HTTP 200 |
| `move-build-test.yml` | push touching `contracts/sui/**` | ✅ | Sui framework/mainnet |
| `solana-build-test.yml` | push touching `contracts/solana/**` | ✅ | Rust + Anchor build |
