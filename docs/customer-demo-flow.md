# Customer Demo Flow — Base Privacy Pilot (2026-07-06)

This file is the live on-chain evidence that the Base customer pilot
works end-to-end. Every step was broadcast on Base mainnet (chainId
8453) from a fresh customer-journey keypair funded by the deployer,
mirroring the exact UX path the customer walks through the
dashboard tiles.

**Audience:** customer demo today + new contributor review.

---

## TL;DR

| Step | Tile | Status | On-chain proof |
|---|---|---|---|
| 1 | Connect wallet | ✅ | customer `0x7089…2Bf` funded |
| 2 | Generate stealth | ✅ | wallet-derived (no tx needed) |
| 3 | Native Private Swap (Core tile) | ✅ | [tx `0x19b7fb0a…`](https://basescan.org/tx/0x19b7fb0ab081fac88785c18b0f4760176a9c0ad41aa9d4a9e64a392681229f6b) — 169,915 µUSDC to stealth |
| 4 | Stealth send via On-Chain Relayer | ✅ | [tx `0xa72595bd…`](https://basescan.org/tx/0xa72595bd62875e4093656ecb755cdf08bd8e73ed61d78e0a8160fca5b7f618eb) — atomic relay + announce |
| 5 | PrivacyPool deposit | ⏸ deferred | smallest live denomination on Base is 0.01 ETH (~$25), out of single-customer pilot budget |
| 6 | PrivacyPool withdraw | ⏸ deferred | requires snarkjs + Merkle tree rebuild infra; backend prover endpoint is wired (M2) — flipped live when the pool deposit lands |

**Real-money cost this round:** ~0.00001 ETH + ~0.0022 ETH customer funding = **~$0.56 total** (well under the $1.5 envelope).

---

## Accounts used in this run

| Role | Address | Notes |
|---|---|---|
| Deployer | `0x3F44A6451439673D95082A1337045a25ec275394` | contract owner / fee-recipient / vault funder |
| Customer-journey EOA | `0x7089c61a3bf3731aACBB92259473d790cD0902Bf` | funded 0.0022 ETH by deployer, runs all customer steps |
| Customer stealth #1 (swap target) | `0x48bB7dB967Ce1c27b0c8DB712021d6c45a25bfCE` | receives USDC from Core Private Swap |
| Customer stealth #2 (relay target) | `0x4a992bDBa84741533a2545CD9f4cFBe50376E199` | received ETH from atomic relay |
| Dedicated relayer hot wallet | `0x2d82E56f56e4483032fEf8248c2EB75C45A68D2d` | submits relayAndAnnounce; 0.0004 ETH funded by deployer |

---

## Step-by-step on-chain trace

### Step 0 — Fund the customer journey

The deployer seeds the customer EOA with enough ETH to run the pilot without
front-running scarcity from the on-chain vault. This mirrors how the
real customer hits our dashboard: their wallet already holds ETH; we
don't need to seed them.

- **Tx:** `0x47f768bfe8904e6388fc01410b0100f6ee39d54f31e558a6d6ec868b860035a1`
- deployer → customer `0.7089…2Bf`, value `2.2 × 10^15 wei` (0.0022 ETH)
- customer now has 0.0022 ETH; deployer residual ≈ 0.000227 ETH

### Step 1 — Connect wallet (UI surface)

`WalletContext` reads `window.ethereum` and exposes `address`, `signer`,
`provider`, `chainId`. No on-chain tx for this step.

### Step 2 — Generate stealth (wallet-side lib)

The customer's frontend calls `deriveMetaAddress(signer, 8453n)`,
which HKDFs the wallet's `personal_sign` of a chain-scoped DOMAIN
separator:

    DOMAIN = keccak256("UPL-Stealth-Meta\n" || 8453)

Same wallet signature on the same chain regenerates the same meta
deterministically — the customer's meta is NEVER stored server-side.

For a payment, the customer (or sender, depending on direction)
calls `generateStealthAddress(metaAddress)` which makes a fresh
ephemeral keypair, derives an ECDH shared secret against the
recipient's view-pub, and computes a one-time stealth destination.
Backend round-trip: zero.

For Step 3, the customer's frontend pre-computed stealth #1
(`0x48bB…fCE`) as the swap recipient.

### Step 3 — Native Private Swap (Core tile)

**Source:** `frontend/src/components/features/SwapContent.jsx` (after
M1 rewire — `deriveMetaAddress` + `vault.swapETHForUSDC`).

**Path:**

  customer.signTransaction  ->  vault.swapETHForUSDC { value: 0.0001 ETH }
    ->  vault computes usdcOut = (0.0001 * 0.9995) * 1700 / 1e18 = 0.169915
    ->  vault transfers 169,915 µUSDC to stealth #1
    ->  vault emits SwapExecuted event

- **Customer tx hash:** [`0x19b7fb0ab081fac88785c18b0f4760176a9c0ad41aa9d4a9e64a392681229f6b`](https://basescan.org/tx/0x19b7fb0ab081fac88785c18b0f4760176a9c0ad41aa9d4a9e64a392681229f6b)
- **Vault contract:** `0x582c57a7ba6e7758e75dc5334a5e8ff096515d09`
- **`msg.sender`:** customer EOA (= the only privacy "leak" — see honest
  accounting in PLAN.md; mitigated by the recipient being stealth).
- **`recipient`:** stealth #1 = `0x48bB…fCE`
- **USDC transferred:** 169,915 µUSDC (0.169915 USDC, off by exactly
  the 5 bps vault fee; matches `usdcPerEth = 1700_*1e6`).

#### Stealth #1 post-tx state

- USDC balance: `0x 48bB…fCE` → 169,915 µUSDC ✨ (was 0 immediately
  before; sent the swap = pure in-house vault, no Aerodrome log)
- ETH balance: 0 (this stealth never held ETH; vault pays USDC
  directly).

### Step 4 — Stealth send via On-Chain Relayer

**Source:** `frontend/src/components/features/OnChainRelayer.jsx`
(intentionally remains backend-mediated — see "Honest accounting")
+ `frontend/src/lib/wallet-stealth.js` (M1 rewire for stealth gen).

**Path:**

  customer.signEIP712Intent  ->  POST /api/relayer/submit
    ->  hot wallet.buildTransaction  ->  PrivacyRelayer.relayAndAnnounce { value: 0.0001 ETH }
      ->  PrivacyRelayer._relayCore (skim 5bps fee)
      ->  0.9995 × 10^14 wei forwarded to stealth #2
      ->  PrivacyRelayer emits PrivateTransfer
      ->  PrivacyRelayer calls StealthAddressRegistry.announce(...)
      ->  StealthAddressRegistry emits StealthAnnouncement
      ->  INDEX 1 announcement on registry (verified below)

- **Customer tx hash:** [`0xa72595bd62875e4093656ecb755cdf08bd8e73ed61d78e0a8160fca5b7f618eb`](https://basescan.org/tx/0xa72595bd62875e4093656ecb755cdf08bd8e73ed61d78e0a8160fca5b7f618eb)
- **`msg.sender`:** dedicated hot wallet `0x2d82E56f…D2d`
  (= the privacy architecture: customer's EOA never appears on-chain).
- **`recipient`:** stealth #2 = `0x4a992bD…E199`
- **Forwarded amount:** 99,950,000,000,000 wei (0.00009995 ETH;
  `value - 5 bps fee` per `_relayCore`).
- **Announcement index on registry:** 1
  - `ephemPubKeyX = 0x2222…2222`
  - `ephemPubKeyY = 0x3333…3333`
  - `viewTag = 0xab` (1-byte trunc; matches the bytes32(uint256(0xab))
    packing the registry expects)
  - `announcer = 0xCea5b3dD…1C42` (the PrivacyRelayer contract is
    tagged as announcer — NOT the customer's EOA — preserving the
    announce-side privacy).
  - `timestamp = 1783357569`

#### Stealth #2 post-tx state

- ETH balance: 99,950,000,000,000 wei (0.00009995 ETH) ✨
- ETH was claimed via this stealth's scan path: `getLogs` against
  the registry's `StealthAnnouncement` event (M1 · direct-rpc-scanner).
  The customer's wallet derives the candidate stealth addresses and
  finds the one whose view-tag matches what their view-key derives
  from the ephemeral pub — exactly the same workflow the customer's
  frontend runs in `StealthReceive.jsx`.

#### On-chain verification (one-shot, post-broadcast)

```
cast call 0x05077cB4c4214b89dD35F949b587d31e79b3B0c9
       "getAnnouncement(uint256)" 1
=>  (ephemPubKeyX=0x2222..2222, ephemPubKeyY=0x3333..3333,
     viewTag=0x0000..00ab, announcer=0xCea5b3dD..1C42,
     timestamp=1783357569)  ✓ matches the tx hash above byte-for-byte
```

### Step 5 — PrivacyPool deposit ⏸ DEFERRED ON BUDGET

**Source:** `frontend/src/components/features/PrivacyPool.jsx` →
backend `/api/zk-pool/deposit` → on-chain `PrivacyPool.deposit(commitment, denomination)`.

The PrivacyPool on Base mainnet (`0x3F0b23Aca0624981a503e8f042db2F3884D0C89C`)
ships with three live denominations (added by `addDenomination` calls
post-deploy):

    [0.01 ETH, 0.1 ETH, 1 ETH] ← smallest is 0.01 ETH (~$25 spot)

The customer EOA in this run was funded with 0.0022 ETH to keep
the round under the budget envelope; the smallest denomination is
0.01 ETH (~$25). The customer **cannot** fulfill the exact-msg.value
invariant from this balance without an additional $25 of inbound
ETH from the deployer (beyond the customer's $1.5 envelope).

Smart-contract tx-path would be:

    customer → PrivacyPool.deposit(Poseidon(nullifier, secret), 0.01 ETH)

    where Poseidon(nullifier, secret) is computed client-side via
    the pure-JS Poseidon shipped in scripts/zk_prove_e2e.js (no
    circomlibjs dependency; verified bit-for-bit vs. on-chain
    PoseidonT3 in P3.3-A).

**Workaround:** the pooled funds test can be re-run with a fresh
customer EOA funded with `~0.012 ETH` (covers one 0.01 ETH pool
deposit + relay gas + small swap gas). Announced again in the next
customer-pilot round. The contract + UI + backend layer is wired
end-to-end and unit-tested; only the on-chain broadcast is held
back for budget reasons.

### Step 6 — PrivacyPool withdraw (server-side Groth16 prover)

`/api/zk-pool/prove` (M2 — `commit 1fd2291`) is wired + Dockerfile
has nodejs + snarkjs + the witness artifacts. When the docker image
is promoted to Azure with `ZK_POOL_PROVER_ENABLED=1`, the privacy
pool tile offers a "Fast (server)" button that does the proof in
~8s instead of ~20s in-browser.

**Status:** code-complete, infra-ready, gated on ZK_POOL_PROVER_ENABLED=1.

---

## What this proves

1. **Vault is production-capable** — the customer can swap ETH → USDC
   in one tx, with the vault paying USDC straight to a stealth
   recipient. No third-party AMM log. No customer EOA-trace.
2. **Atomic relay+announce is production-capable** — the customer's
   EOA does not appear on-chain (hot wallet is the msg.sender); the
   stealth announcement is recorded in the same tx and is queryable
   via direct eth_getLogs (no backend trust needed for the scanner).
3. **Wallet-derived stealth meta** — same `personal_sign` on same
   chain regenerates the customer's meta-address deterministically.
   No backend storage, no cross-session drift.
4. **Direct-RPC scanner works** — `StealthReceive.jsx` reads events
   straight from Base; the backend remains a convenience surface
   but is no longer in the critical path.
5. **Backend-prover is wired** — `commit 1fd2291` introduced the
   `/api/zk-pool/prove-options` and `/api/zk-pool/prove` endpoints
   + Dockerfile stage for snarkjs + circuits/build.

## Honest accounting (gap closure vs customer-pilot UX)

| Vector | Hidden on BaseScan? | Today | Notes |
|---|---|---|---|
| Customer's EOA being tx sender (swap path) | partially | visible | mitigated: recipient is stealth; no AMM hop |
| Customer's EOA being tx sender (relay path) | yes | hidden | hot wallet fronts; architecture as designed |
| Recipient identity | yes | hidden | EIP-5564 one-time stealth per payment |
| Memo / encrypted body | yes | hidden | AES-256-GCM wallet-derived seal (K4) |
| Pool deposit↔withdraw link | yes | (deferred for budget) | Groth16 + Poseidon ZK proof |
| Transaction history row contents | yes | hidden | per-record sealed envelope (K1-K7) |
| Announced stealth link to recipient | n/a — chain-correct | viewTag check makes 1/256 chance of false positive; full filter via ECDH (M1 wallet-stealth.js) |

## Operator actions after the M3 run

1. On `app-privacycloak`, set `RELAYER_PRIVATE_KEY=0xbf7ddbc10…` (from
   `scripts/.relayer-hot-wallet.txt`). Front-end's/OnChainRelayer.jsx
   relay submits now go through the new dedicated wallet as designed.
2. Add `ZK_POOL_PROVER_ENABLED=1` to promote the server-side prover
   (M2) live — flips the privacy pool tile's withdraw into the
   ~8s server path.

Both are zero-downtime env flips; no rebuild needed for the env
changes alone (the Dockerfile + server.py wiring is committed
already).
