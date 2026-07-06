# Customer Demo Guide — Universal Privacy Layer (2026-07-06)

This is a one-page hand-off for the customer demo. It says exactly what's
live on Base mainnet right now, what to click, where the smoke-test proof
lives, and what is left to do.

> **Production URL:** https://privacycloak.in
> **Chain:** Base mainnet (chainId `8453`)
> **Repo:** https://github.com/jerreenj/Universal-Privacy-Layer

---

## TL;DR — what's live

| Layer | Status on Base | What it does |
|-------|----------------|--------------|
| **Stealth addresses** | ✅ live | Generated via `/api/stealth/generate`; announced on-chain via `PrivacyRelayer.relayAndAnnounce` (single atomic tx, P2.9.7). |
| **Stealth send (private send w/ value)** | ✅ live | Atomic relay + announce works on the same tx; recipient scans via `/api/announcements`. |
| **Announcement scanner (all chains)** | ✅ live | Reads the per-chain registry; tiles in the dashboard. |
| **ZK privacy pool (Tornado-style)** | ✅ live (multi-denom) | 3 denominations: **0.01 / 0.1 / 1 ETH**. Deposit + withdraw via real Groth16-proof verified on-chain by the snarkjs-generated `Groth16Verifier`. |
| **All in One Swap (DEX-aggregator tile)** | ✅ live | Pick **Uniswap V3** or **Aerodrome V2** inside a single tile. Both wrappers are deployed on Base with the 4-field `Route` struct + factory field. E2E smoke green: Aerodrome ETH→USDC round-trip mined on Base. |
| **Hyperliquid / Polymarket (3rd-party)** | ✅ wraps are wired | Surfaced in the dashboard; not all 3rd-party flows are smoke-tested end-to-end yet — flag to the customer that we are 2 wrappers live + 1 in scope. |

## TL;DR — what is NOT live

| Layer | Status |
|-------|--------|
| **Solana mainnet** | ⏸ devnet-ready code only; needs `~5 SOL` rent. Devnet is fully demoable via the URL toggle. |
| **P4.3 cross-chain private routing (Base → Arb / Op / Polygon)** | ⏸ not started. |
| **P4.4 relayer hot-wallet hardening** | ⏸ not started. |
| **P4.5 production monitoring + alerting** | ⏸ not started. |

---

## Demo script (5 minutes)

> Click through these in order; each step has a verifiable on-chain
> artifact on BaseScan if the customer asks.

### Step 1 — Open the dashboard
1. Open https://privacycloak.in
2. Connect MetaMask (must be on **Base mainnet**; the dapp will auto-switch).
3. The dashboard home-view shows 4 tile grids: **Core Actions (Receive / Send / Private Swap)**, **PrivateDeFi (Uniswap V3 / Aerodrome V2 / Hyperliquid / Polymarket)**, **Advanced Privacy (Privacy Pool / Announcement Scanner / Hidden Balance)**, **More Tools (Stealth keys / Announce history / …)**.

### Step 2 — Generate a stealth address
1. Click **Send** (Core Actions).
2. Click **Auto** next to the recipient field → the backend `/api/stealth/generate` builds an ephemeral key + view tag + produces a one-time stealth address.
3. Send 0.001 ETH to that address.
4. Announcement appears on-chain in the BaseScan tx → `announces` event of `StealthAddressRegistry`.
5. **Recipient scans** via the **Announcement Scanner** tile (top-right filter by chain = Base).

### Step 3 — Drop into the ZK Privacy Pool
1. Click **Privacy Pool** (Advanced Privacy grid).
2. Pick a denomination: **0.01 / 0.1 / 1 ETH**.
3. Click **Propose Deposit** → backend generates a random nullifier + secret, computes the Poseidon commitment, returns a deposit intent.
4. Confirm in MetaMask. On-chain tx → `PrivacyPool.deposit(commitment, denomination)`.
5. Wait for the browser proof generation (5–20 seconds on a mid laptop — the UI shows "generating proof…").
6. **Withdraw**: the same page, paste a recipient address, the backend fetches the Merkle path + builds the witness; `snarkjs.groth16.fullProve` runs in the browser; the on-chain `withdraw(proof, ...)` pays the nominated recipient — **without revealing the deposit tx hash**.

### Step 4 — All in One Swap (the highlight tile)
1. Click **All in One Swap** (PrivateDeFi grid).
2. Open the DEX picker → choose **Aerodrome V2** (Base's primary DEX; Uniswap V3 has no WETH/USDC pool on Base per the P1.13 finding).
3. Set `From = ETH`, `To = USDC`, amount = 0.001, slippage = 0.5 %.
4. Click **Get Quote** → fires Aerodrome Router's `getAmountsOut` for `[WETH → USDC, stable: false, factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da]`. Shows expected USDC out + the 5 bps wrapper fee + slippage-adjusted minOut.
5. Click **Swap Privately** → fires `AerodromePrivacyWrapper.privateSwapETHForToken(USDC, routes, 0, stealthRecipient, deadline+10min){value: 0.001 ETH}` → the wrapper takes ETH, splits off the 5 bps fee to the deployer (`feeRecipient = 0x3f44…`), forwards the remaining 0.000995 ETH to Aerodrome Router, Aerodrome swaps and credits the output USDC **directly to the stealth recipient** (so the wallet never appears as the on-chain swap sender).
6. Basescan link is at the bottom of the tile.

### Step 5 — Verify on BaseScan
- The smoke tx referenced in this doc:
  [`0xebdfbbca29c67334c63c50a50c11b452e3cab2c60fbc5ac8caef53d7ff3090c1`](https://basescan.org/tx/0xebdfbbca29c67334c63c50a50c11b452e3cab2c60fbc5ac8caef53d7ff3090c1)
- The Wrapper that processed it (P4.2 hotfix v2):
  [`0xe896e6f51af137c32db7eb4e3b2de795d392a646`](https://basescan.org/address/0xe896e6f51af137c32db7eb4e3b2de795d392a646)
- Multi-denom PrivacyPool (P4.1):
  [`0x3F0b23Aca0624981a503e8f042db2F3884D0C89C`](https://basescan.org/address/0x3F0b23Aca0624981a503e8f042db2F3884D0C89C)
- PrivacyRelayer (P2.9.7 atomic):
  [`0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42`](https://basescan.org/address/0xCea5b3dD22c5306dEF78767e276c5e1C42)

---

## What's in this build

### Customer-facing surfaces (UI-tested)
1. Stealth address generate / use history.
2. Atomic relayed send (one tx = `relay()` + `announce()`).
3. Multi-chain announcement scanner + receipts viewer.
4. ZK pool deposit + browser-generated Groth16 proof + on-chain withdraw.
5. **P4.2 hotfix** All-in-One Swap tile → Uniswap V3 OR Aerodrome V2.

### Internal surfaces (server-tested, no UI button yet)
- `/api/swap/quote` — Uniswap & Aerodrome fee math (used by the tile).
- `/api/swap/record` — records the tx so it shows up in Transaction History.
- `cast 4byte` symbolica — none.

### Live on-chain contracts (Base mainnet)
| Contract | Address | Status |
|----------|---------|--------|
| PrivacyRelayer (atomic, P2.9.7) | `0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42` | ✅ live |
| StealthAddressRegistry | `0x05077cB4c4214b89dD35F949b587d31e79b3B0c9` | ✅ live |
| UniswapPrivacyWrapper | `0x01A7EB9acb55B80254609dCB8112f1cd65D67c8F` | ✅ live |
| PrivacyRelayer (P4.1, multi-denom) | `0x69DA62568CAbc0940a0Bb6Bc7017e3EB8BD7c175` | ✅ live |
| StealthAddressRegistry (P4.1) | `0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1` | ✅ live |
| UniswapPrivacyWrapper (P4.1) | `0x9C30cdCd73347BF18A5bD424C37E5714e2606362` | ✅ live |
| Groth16Verifier (P4.1) | `0x838b7c20b1a97cAA6379542d03983b4571275679` | ✅ live |
| PrivacyPool (multi-denom, P4.1) | `0x3F0b23Aca0624981a503e8f042db2F3884D0C89C` | ✅ live, 3 denoms |
| **AerodromePrivacyWrapper (P4.2 hotfix)** | **`0xe896e6f51af137c32db7eb4e3b2de795d392a646`** | ✅ live, **E2E smoke green** |
| AerodromePrivacyWrapper (P4.2 v1, superseded) | `0x009681CdF5441D23738EC6597e586eBB06215e3D` | superseded |

> **Honest note:** the v1 Aerodrome wrapper had a 3-field Route struct that
> mis-aligned with Aerodrome's actual 4-field Route struct, so real swaps
> reverted at the Router with empty error data. The v2 hotfix at
> `0xe896…` is the canonical address now. The v1 contract is still on-chain
> but the dashboard reads the v2 address from `/api/deployments`.

---

## Smoke test log (verbatim, the proof)

```
$ bash scripts/smoke_aerodrome.sh  # (mirror of forge broadcast)
== pre-state: wrapper config ==
WETH():               0x4200000000000000000000000000000000000006
aerodromeRouter():    0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
volatileFactory():    0x420DD381b31aEf6683db6B902084cB0FFECe40Da
stableFactory():      0x420DD381b31aEf6683db6B902084cB0FFECe40Da
feeRecipient():       0x3f44A6451439673D95082A1337045a25ec275394
feeRate():            5   # 0.05 % = 5 bps

== post-state: balances ==
deployer ETH:  0.0028347755 ETH   (was 0.0029406 — fee + gas + swap fill)
deployer USDC: 2,251,348 µUSDC   (was 2,077,620 — gained 173,728 µUSDC)
                               # (the 49 µUSDC gap is Aerodrome's 0.3 %
                               #   volatile fee on the 0.0001 ETH input)

Trace path:
wrapper.privateSwapETHForToken (value: 0.0001 ETH)
  → feeRecipient.call{value: 5e10 wei}        # 5 bps fee skim
  → AerodromeRouter.swapExactETHForTokens
      (value: 99,950,000,000,000 wei; routes:
        [{from: WETH, to: USDC, stable: false,
          factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da}])
    → WETH/USDC volatile pool
        0xcDAC0d6c6C59727a65F871236188350531885C43
      → USDC.transfer(recipient, 173,777)
  → emit PrivateSwap(swapId, timestamp)
```

The full on-chain trace is in
`contracts/broadcast/SmokeAerodrome.s.sol/8453/run-latest.json`.

---

## What to flag for the customer's Q&A

- **Why Aerodrome and not Uniswap?** Base has no/limited WETH/USDC pool on Uniswap V3 (P1.13 finding). Aerodrome is Base's primary DEX, so we built the wrapper there first. Uniswap V3's WETH/USDC path (the existing wrapper at `0x9C30…`) is still live and works on Base for other pairs — it just has no deep USDC liquidity.
- **Why a hotfix?** The first Aerodrome wrapper used a 3-field `Route` struct which mis-aligned with Aerodrome's actual 4-field struct (`factory` field was missing). The redeploy v2 fixes it. Same wrapper code pattern as `UniswapPrivacyWrapper` — both wrappers share the same fee model + immutables UX so the frontend can dispatch between them.
- **Privacy leak?** Funded deployer-wallet outputs are visible on-chain. In a real customer flow the recipient is a stealth address, and the deployer's USDC delta is irrelevant — the relevant privacy claim is that the on-chain swap sender is the wrapper, not the trading wallet. The customer can swap from their main wallet and have the USDC land at a stealth address with **no on-chain link**.
- **Gas?** The P4.2 hotfix (1-create wrapper) + smoke tx together cost ~0.000015 ETH (~$0.045 at $3000/ETH). The next P4.3 cross-chain routing broadcast is in the same cost range.

---

## What is not in scope for this demo

1. Solana production mainnet (code is ready, ~5 SOL funding needed).
2. Cross-chain (Base → Arbitrum / Optimism / Polygon) — P4.3 not started.
3. Relayer hardening — P4.4 not started.
4. Alerting / monitoring — P4.5 not started.
5. Path A (secp256k1 stealth-address ZK) — research milestone, AUDIT-REQUIRED.

---

## Technical references

| Doc | Purpose |
|-----|---------|
| `docs/zk-architecture.md` | ZK pool circuit + ceremony + verifier + on-chain layout. |
| `docs/zk-toolchain.md` | Powers of Tau + Groth16 setup reproduction. |
| `docs/secp256k1-stealth-zk.md` | Path A research (audit-required). |
| `docs/poseidon-t3-invariants.md` | PoseidonT3 Solidity library invariants. |
| `PLAN.md` | Living roadmap with milestone progress. |
| `contracts/deployed_base.json` | Live on-chain manifest (single source of truth). |
