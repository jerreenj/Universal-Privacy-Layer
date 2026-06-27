<div align="center">

<br>

<img src="https://img.shields.io/badge/%E2%96%88%E2%96%88%E2%96%88-UPL-00FF94?style=for-the-badge&labelColor=000000" alt="UPL" />

<br><br>

# Universal Privacy Layer

### The invisible backbone for On-chain finance.

<br>

[![Live](https://img.shields.io/badge/LIVE-privacycloak.in-00FF94?style=for-the-badge&labelColor=0a0a0a)](https://privacycloak.in)
&nbsp;&nbsp;
[![Chains](https://img.shields.io/badge/NETWORKS-9-00F0FF?style=for-the-badge&labelColor=0a0a0a)](#-supported-networks)
&nbsp;&nbsp;
[![Status](https://img.shields.io/badge/STATUS-PRIVATE%20BETA-FF3B30?style=for-the-badge&labelColor=0a0a0a)](#)
&nbsp;&nbsp;
[![Solidity](https://img.shields.io/badge/SOLIDITY-3_CONTRACTS-9945FF?style=for-the-badge&labelColor=0a0a0a)](#-smart-contracts)
&nbsp;&nbsp;
[![Move](https://img.shields.io/badge/MOVE-12_MODULES_123_TESTS-5C2D91?style=for-the-badge&labelColor=0a0a0a)](#sui-move-package-contractssui)
&nbsp;&nbsp;
[![API](https://img.shields.io/badge/API-80%2B_ENDPOINTS-F7931A?style=for-the-badge&labelColor=0a0a0a)](#-architecture)

<br>

*Trade. Swap. Send. Bet.*
*Without your wallet being traced. Ever.*

<br>

---

</div>

<br>

## The Problem

Every on-chain transaction is a **permanent public record.**

When you swap on Uniswap, open a leveraged position on Hyperliquid, or place a bet on Polymarket — your wallet address, the exact amount, the timestamp, and every counterparty are visible to anyone, forever. Block explorers index it. MEV bots front-run it. Analytics firms profile it. Your entire financial identity is an open book.

**Wallets get:**
- Profiled across protocols (your Uniswap trades linked to your Polymarket bets)
- Front-run by MEV bots watching your pending transactions
- Cross-chain tracked by analytics firms building shadow profiles
- Targeted with phishing after large transactions become public
- Flagged and blacklisted based on association with other wallets
- Exploited through sandwich attacks on high-value pending swaps

> *"If you think deleting your transaction history is possible, you don't understand blockchains. Every trace is permanent. The only solution is to never leave one."*

<br>

## The Solution

UPL is **architected to make your wallet unlinkable** from any transaction.

Every operation — whether it's a token swap, a perp trade, a prediction bet, or a simple transfer — is routed through a freshly generated **stealth address** backed by **zero-knowledge cryptography**. The origin wallet and the destination exist in two completely separate on-chain realities. Designed to leave no link, no trace, no fingerprint.

```
  Your Wallet                                           The Blockchain
       │                                                       │
       │   ┌──────────────────────────────────────────┐        │
       │   │  1. Stealth Address Generation           │        │
       │   │  2. ZK Proof Construction                │        │
       │   │  3. Cross-Chain Fragmentation            │        │
       │   │  4. Relayer Submission                   │        │
       │   └──────────────────────────────────────────┘        │
       │                                                       │
       └──────── architected for unlinkability ───────────────────>│
                                                               │
                 No link.  No trace.  No fingerprint.          │
                                                               │
                 The path is not reconstructible from on-chain data alone.         │
```

<br>

---

<br>

## Supported Networks

<table>
<tr>
<th align="left">Network</th>
<th align="left">Type</th>
<th align="left">Native Token</th>
<th align="center">Private Send</th>
<th align="center">Private Swap</th>
<th align="left">Private DeFi</th>
</tr>
<tr>
<td><b>Base</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3</td>
</tr>
<tr>
<td><b>Arbitrum</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3 &middot; Hyperliquid</td>
</tr>
<tr>
<td><b>Polygon</b></td><td>EVM L1</td><td>POL</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3 &middot; Polymarket</td>
</tr>
<tr>
<td><b>Optimism</b></td><td>EVM L2</td><td>ETH</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>Uniswap V3</td>
</tr>
<tr>
<td><b>BNB Chain</b></td><td>EVM L1</td><td>BNB</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Avalanche</b></td><td>EVM L1</td><td>AVAX</td>
<td align="center">&#x2713;</td><td align="center">&#x2713;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Hyperliquid</b></td><td>L1 Perps</td><td>HYPE</td>
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>229 Perpetual Markets &middot; 50x Leverage</td>
</tr>
<tr>
<td><b>Solana</b></td><td>SVM</td><td>SOL</td>
<td align="center">&#x2713;</td><td align="center">&mdash;</td><td>&mdash;</td>
</tr>
<tr>
<td><b>Sui</b></td><td>MoveVM</td><td>SUI</td>
<td align="center">&#x2713;<sup>&dagger;</sup></td><td align="center">&mdash;</td><td>&mdash;</td>
</tr>
</table>

<sup>&dagger;</sup> Sui Move package `upl` (12 modules) is written, unit-tested
(123/123 green), and CI-gated; publication to testnet via `scripts/deploy_sui_testnet.sh`
is staged. See [Sui Move package](#sui-move-package-contractssui).

<br>

---

<br>

## Privacy Primitives

<table>
<tr>
<td width="50%">

### Stealth Addresses
A unique one-time address is generated for **every transaction** using an EIP-5564 compliant ephemeral keypair derived from `secp256k1` elliptic curve cryptography. The recipient is the only entity who can mathematically detect and claim the funds. There is zero on-chain link between sender and receiver.

**Standard:** EIP-5564 &middot; **Curve:** secp256k1 &middot; **Key Exchange:** ECDH

</td>
<td width="50%">

### Zero-Knowledge Proofs
Groth16 proofs (constructed with Circom circuits) enable you to prove ownership of funds, satisfy range constraints, or demonstrate set membership — **without revealing any underlying data.** The blockchain verifies the proof. It never sees the secret.

**Proof System:** Groth16 &middot; **Circuit Language:** Circom &middot; **Verification:** On-chain Solidity

</td>
</tr>
<tr>
<td>

### Privacy Relayer
A dedicated smart contract relayer submits transactions on behalf of the user. Your wallet address **never appears as the transaction origin.** Gas is abstracted. The relayer is the only address visible on-chain.

**Gas:** Abstracted &middot; **Visibility:** Only relayer address on-chain &middot; **User Wallet:** Hidden

</td>
<td>

### Cross-Chain Fragmentation
A single transaction is broken into multiple fragments and dispatched across **different chains simultaneously.** Amount correlation analysis — one of the most effective de-anonymization techniques — becomes computationally infeasible.

**Chains:** Up to 9 simultaneous &middot; **Analysis Resistance:** Amount, timing, chain correlation

</td>
</tr>
</table>

<br>

---

<br>

## Private DeFi Integrations

<table>
<tr>
<td width="33%">

### Uniswap V3

Token swaps routed through a stealth proxy contract. Quotes fetched directly from the on-chain Quoter contract, with DeFiLlama as a price oracle fallback. Swap output lands in a **freshly generated stealth address.**

Your wallet never touches the DEX.

**Chains:** Base, Arbitrum, Polygon, Optimism

</td>
<td width="33%">

### Hyperliquid

Open perpetual futures with margin routed through a fresh stealth proxy on every trade. **229 available markets** with up to **50x leverage.** Your wallet is never deposited directly.

Every position is isolated behind a unique ephemeral address.

**Markets:** 229 &middot; **Max Leverage:** 50x

</td>
<td width="33%">

### Polymarket

Prediction market bets via stealth USDC proxy. Your wallet **never interacts with the CLOB.** Bet, win, and withdraw — all through one-time stealth addresses.

Designed to prevent linkage back to your identity.

**Chain:** Polygon &middot; **Token:** USDC

</td>
</tr>
</table>

<br>

---

<br>

## Additional Capabilities

| Feature | Description |
|:--------|:------------|
| **End-to-End Encrypted Messaging** | `secp256k1` ECDH key agreement + `AES-256-GCM` symmetric encryption. Server processes only ciphertext. Even UPL cannot read your messages. Messages are deleted after 30 days. |
| **Hidden Balance Aggregation** | Unified view of all funds held across your stealth addresses, broken down by chain and token. No external observer can reconstruct the full picture. |
| **NFT Privacy Transfer** | Move NFTs (ERC-721, ERC-1155) between wallets without creating an on-chain link between sender and receiver. Metadata is never exposed. |
| **Token Approval Privacy** | Manage ERC-20 approvals through stealth proxies to prevent on-chain approval fingerprinting. Revoke and re-approve without trace. |
| **Multisig Privacy Vaults** | Multi-signature wallet flows with hidden participant identities. Signers are never revealed on-chain. Threshold configurable from 2-of-3 to M-of-N. |
| **Contract Interaction Privacy** | Interact with any smart contract through a stealth proxy. Your wallet address is never exposed as the `msg.sender`. |
| **Progressive Web App** | Installable on mobile and desktop with offline caching, service worker support, and native-like experience. |
| **Developer API** | Full programmatic access with API key management. Build privacy features into your own applications. |

<br>

---

<br>

## Architecture

```
Universal-Privacy-Layer/
│
├── backend/                            Python 3.11 · FastAPI · async data layer
│   ├── server.py                       80+ API endpoints, single-file microservice
│   │   ├── Session Auth                Passphrase → token, rate-limited, database-persisted
│   │   ├── Stealth Engine              EIP-5564 meta-address generation, announcement relay
│   │   ├── Privacy Router              Cross-chain splits, relayer dispatch, fee calculation
│   │   ├── DeFi Integrations           Uniswap V3, Hyperliquid, Polymarket CLOB
│   │   ├── Encrypted Messaging         True E2E (ECDH + AES-GCM) with legacy fallback
│   │   ├── Crypto Payments             Direct wallet, QR code, MetaMask one-click
│   │   ├── Developer API               Key issuance, rate limiting, usage tracking
│   │   └── Security Middleware         CORS, headers, rate limiting, input sanitization
│   └── requirements.txt
│
├── contracts/                          EVM + Sui Move on-chain privacy logic
│   ├── PrivacyRelayer.sol              Gas-only meta-tx forwarder (onlyRelayer, EIP-712 intent)
│   ├── StealthAddressRegistry.sol      On-chain stealth announcement registry (EIP-5564)
│   ├── UniswapPrivacyWrapper.sol       Stealth-routed Uniswap V3 swap interactions
│   └── sui/                            Sui Move 2024 package ("upl") · Move.toml pin rev=framework/testnet
│       ├── sources/                    12 production modules: stealth_address_registry, privacy_relayer,
│       │                               prepaid_ticket, privacy_receipt, stealth_transfer, uopl_multisig,
│       │                               view_tag_index, fee_splitter, announcement_indexer, cancel_nonce,
│       │                               relayer_registry, timelock_cap
│       └── tests/                      12 #[test_only] modules · 123 unit tests · `sui move test`
│
├── .github/workflows/move-build-test.yml   CI gate: `sui move build` + `sui move test` on every PR
├── scripts/deploy_sui_testnet.sh            Testnet publish script → scripts/deployed_sui_testnet.json
│
├── frontend/                           React 18 · Tailwind CSS · ethers.js · Web3Modal
│   └── src/
│       ├── App.js                      Minimal router (60 lines)
│       ├── components/                 25+ modular feature components
│       │   ├── auth/                   Access gate with brute-force protection
│       │   ├── features/               Stealth send/receive, messaging, DeFi, NFT, multisig
│       │   ├── layout/                 Navbar, dashboard hub, animated landing
│       │   ├── common/                 BackButton, CopyButton, shared utilities
│       │   └── ui/                     shadcn/ui primitives
│       ├── pages/                      Route-level page components
│       ├── config/                     Chain registry, RPC endpoints, API constants
│       ├── context/                    Multi-chain wallet state provider (WalletContext)
│       ├── lib/                        messageCrypto.js (ECDH), session.js (token mgmt)
│       └── utils/                      stealth.js — EIP-5564 secp256k1 elliptic curve math
│
└── Dockerfile                          Multi-stage build: Node 22 (frontend) → Python 3.11 (backend)
```

<br>

---

<br>

## System Flow

```
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
         │                       ACCESS GATE                           │
         │              Passphrase → Session Token                     │
         │          Rate-limited · 1-year TTL · storage                │
         │                                                              │
         └────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
         │              STEALTH ADDRESS GENERATOR                      │
         │       EIP-5564 · secp256k1 · ECDH Key Agreement            │
         │       Fresh ephemeral keypair for every transaction         │
         │                                                              │
         └────────────────────────┬─────────────────────────────────────┘
                                  │
            ┌──────────┬──────────┼──────────┬──────────┬───────────┐
            │          │          │          │          │           │
            ▼          ▼          ▼          ▼          ▼           ▼
       ┌─────────┐┌─────────┐┌────────┐┌─────────┐┌─────────┐┌─────────┐
       │ Privacy ││ Uniswap ││ Hyper- ││  Poly-  ││  Cross  ││   E2E   │
       │ Relayer ││ V3 Swap ││ liquid ││ market  ││  Chain  ││  Msg    │
       │         ││ Proxy   ││ Perps  ││  Bets   ││  Split  ││ ECDH   │
       └────┬────┘└────┬────┘└───┬────┘└────┬────┘└────┬────┘└────┬────┘
            │          │         │          │          │          │
            ▼          ▼         ▼          ▼          ▼          ▼
       ┌──────────────────────────────────────────────────────────────┐
       │                                                              │
       │             DESTINATION STEALTH ADDRESS                      │
       │        Mathematically unlinkable from origin                 │
       │        Only the intended recipient can detect & claim        │
       │                                                              │
       └──────────────────────────────────────────────────────────────┘
```

<br>

---

<br>

## Smart Contracts

| Contract | Purpose | Key Mechanism |
|:---------|:--------|:-------------|
| `PrivacyRelayer.sol` | Gas-only meta-tx forwarder. The relayer service (not the user) calls `relay()`; the user's wallet never appears as `msg.sender`. | `onlyRelayer` + EIP-712 signed intent + fee skim |
| `StealthAddressRegistry.sol` | On-chain registry where stealth payment announcements are published. | EIP-5564 ephemeral pub-key announcements + offset-by-1 view-tag lookup |
| `UniswapPrivacyWrapper.sol` | Routes Uniswap V3 swaps through stealth proxies. Output lands in a fresh address. | Proxy pattern with stealth address output routing |

> **ZK verifiers:** `Groth16Verifier.sol` and `UPLVerifier.sol` were removed in P1.3
> (PR #2, commit `db089bc`) — the verifying-key constants set `DELTA == GAMMA`,
> which would silently accept forged proofs. A real `snarkjs`-generated Groth16
> verifier backed by a .circom circuit + a trusted-setup ceremony is the gated
> Phase 3 deliverable. On-chain ZKP verification in the backend
> (`/api/zkp/verify-onchain`, `/api/zkp/verifier-info/{chain}`) returns HTTP 501
> until then — see `backend/server.py` (`ZKP_VERIFIER_PHASED_OUT`).

### Sui Move package (`contracts/sui/`)

The Sui side of UPL is a real, compiling **Move 2024** package `upl`, pinned to
the `framework/testnet` Sui framework rev (`Move.toml`). It is not a stub — all
twelve modules build clean (`sui move build`, 0 errors / 0 warnings) and the
`#[test_only]` suite runs **123/123 green** (`sui move test`). The package mirrors
the EVM privacy primitives in Move's resource/ownership model and adds Sui-native
extensions for view-tag bucketed scanning, cursor-paginated indexing, proportional
fee splitting, intent replay protection, relayer discovery, and time-locked
capability custody.

| Module | Purpose | Key mechanism |
|:-------|:--------|:--------------|
| `stealth_address_registry` | On-chain stealth-announcement registry for Sui. | Shared `Registry` (Tables by announcement id + view-tag) + `StealthAnnouncement` events |
| `privacy_relayer` | Relayed private transfer w/ fee skim + `Clock` timestamps. | `AdminCap`/`RelayerCap` caps, `RelayerState` w/ `Balance<SUI>` accumulator, `Clock` ms timestamps |
| `prepaid_ticket` | Depositor-pays ticket: recipient consumes before drainer sweeps. | `PrepaidTicket` (key+store) holding a `Balance<SUI>` deposit + `TicketConsumed`/`TicketDrained` events |
| `privacy_receipt` | Encrypted per-transfer receipt logging. | `ReceiptCap`-gated `issue`/`list_for_recipient`, `received` view, `ciphertext`+`nonce` are `vector<u8>` |
| `stealth_transfer` | Composes registry, view-tag index, announcement indexer with the relayer. | Direct (no-fee) + relayed (fee-skim) paths; updates `ViewTagIndex` + `AnnouncementIndexer` inline |
| `uopl_multisig` | On-chain M-of-N multisig over UPL capabilities. | Threshold proposal `→` approve `→` execute, `MultiSig` (key+store) holds per-action approvals |
| `view_tag_index` | Per-view-tag bucketed id index over the registry. | Shared `ViewTagIndex` (Table of `Bucket`s); bounded `page(after_id, limit)` scan |
| `fee_splitter` | Proportional fee distribution to multiple operator payees. | `AdminCap`-gated payees + weights (bps), `deposit`/`distribute` splits via `Balance<SUI>` |
| `announcement_indexer` | Cursor-paginated, time-bounded query surface over the registry. | Shared `AnnouncementIndexer` w/ monotonic `high_water_mark`; `scan(after_id, limit)` |
| `cancel_nonce` | On-chain intent-replay protection via monotonic per-address nonces. | `consume(expected)` compare-and-swap + `cancel(target)` void-pending; `Table<address, u64>` |
| `relayer_registry` | Discoverable directory of authorized relayer operators + metadata. | `AdminCap`-gated `approve`/`deactivate`/`reactivate`; endpoint hash commitment per operator |
| `timelock_cap` | Time-locked capability holder with configurable delay. | `deposit<T>` parks cap for `beneficiary`; `withdraw`/`cancel` after/before delay; `AdminCap` sets min delay |

> **Capabilities:** all privileged ops in `privacy_relayer` / `privacy_receipt` /
> `fee_splitter` / `relayer_registry` / `timelock_cap` are gated by typed
> `key + store` capability objects (`AdminCap`, `RelayerCap`, `ReceiptCap`)
> minted to the publisher in `init` — the Sui-native capability pattern, not an
> `ownable` owner-check.

<br>

---

<br>

## Security Model

| Layer | Implementation |
|:------|:---------------|
| **Authentication** | Session token issued after passphrase verification. Required on every API call. Persisted in a managed database with in-memory fallback — survives restarts and disk failures. |
| **Brute Force Protection** | Rate limited: 5 auth attempts per minute per IP address. Exponential backoff on repeated failures. |
| **Private Key Handling** | Generated client-side in browser memory. Returned once to the user for backup. Never stored in any database, server memory, or log file. |
| **Seed Phrase Policy** | Displayed once. Cleared from browser memory immediately after user confirms backup. Never transmitted to backend under any circumstance. |
| **Message Encryption** | `secp256k1` ECDH shared secret derivation + `AES-256-GCM` authenticated encryption. Server is zero-knowledge — processes only ciphertext. |
| **Wallet Session Hygiene** | WalletConnect and MetaMask session storage is wiped on disconnect. No tokens, keys, or state persist after logout. |
| **CORS Policy** | Locked exclusively to production domain. No wildcard origins. Preflight requests validated. |
| **API Surface** | `/docs` and `/openapi.json` endpoints disabled in production. No schema leakage. No route enumeration. |
| **Input Sanitization** | All database queries escaped. All user inputs validated and type-checked server-side. Injection-proof by design. |
| **Error Handling** | Generic error messages only. No stack traces, internal state, or database details exposed in any response. |
| **Request Limits** | 1 MB maximum request body. Payload size enforced at middleware level before any processing. |
| **Security Headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-XSS-Protection: 1; mode=block` on every response. |
| **Database Isolation** | Managed database accessible only to the application. Not exposed to the public internet. No remote access. |
| **Docker Isolation** | Application runs in isolated container. No host filesystem access. Minimal attack surface. |

<br>

---

<br>

## Deployment

UPL is delivered as a **hosted infrastructure service** at
[privacycloak.in](https://privacycloak.in) — running on Azure Container Apps
fronted by Azure-managed TLS, with the image built and deployed on every push
to `main` via GitHub Actions. Self-hosting is not a supported deployment.

### Build & Test (Sui Move package)

The Sui Move package builds and tests against the testnet Sui framework rev. CI
(`.github/workflows/move-build-test.yml`) runs both gates on every PR touching
`contracts/sui/`.

```bash
# Install the Sui CLI testnet build (one-time):  https://docs.sui.io/guides/developer/getting-started

# Build — 0 errors / 0 warnings on testnet framework rev
sui move build

# Unit tests — 123 tests across the 12 #[test_only] modules, all green
sui move test
```

To publish the `upl` package to **testnet** and emit the manifest the backend
reads, run the deploy script (it preflight-checks the active env + gas, builds
fail-fast, publishes, and writes `scripts/deployed_sui_testnet.json` with the
package id + shared object ids + capability object ids):

```bash
sui client switch --env testnet
bash scripts/deploy_sui_testnet.sh
# → scripts/deployed_sui_testnet.json (gitignored; see deployed_sui_testnet.json.example for shape)
```

<br>

---

<br>

## Technical Specifications

| Component | Specification |
|:----------|:-------------|
| **Backend** | Python 3.11, FastAPI, async database driver, httpx |
| **Frontend** | React 18, Tailwind CSS, ethers.js v6, Web3Modal v3, shadcn/ui |
| **Cryptography** | `@noble/secp256k1` v3.0.0, AES-256-GCM, ECDH, Groth16 |
| **Standard** | EIP-5564 (Stealth Addresses) |
| **Smart Contracts (EVM)** | Solidity ^0.8.19 |
| **Smart Contracts (Sui)** | Move 2024, package `upl`, 12 modules, 123 tests, Sui framework rev `framework/testnet` |
| **Database** | Managed document database, indexed collections, TTL-based session cleanup |
| **Containerization** | Multi-stage Docker (Node 22 Alpine + Python 3.11) |
| **TLS** | Azure-managed (Container Apps ingress) |
| **Infrastructure** | Azure Container Apps + Azure Container Registry; GitHub Actions push-to-deploy |

<br>

---

<br>

<div align="center">

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:00FF94,50:001a0e,100:000000&height=100&section=footer&fontSize=0" />

<br>

**[privacycloak.in](https://privacycloak.in)**

<br>

*Built for those who believe financial privacy is a right, not a feature.*

<br>

*All rights reserved.*

</div>
