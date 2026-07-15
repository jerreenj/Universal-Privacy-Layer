# Universal Privacy Layer — Project Plan

**Live:** [privacycloak.in](https://privacycloak.in) · **Repo:** github.com/jerreenj/Universal-Privacy-Layer

**Last updated:** 2026-07-13

---

## TL;DR — what's done

- **Send (USDC)**: ✅ — Stealth Send via EIP-2612 permit + relayer. User's stealth signs permit locally (no wallet popup), relayer submits `permit()` + `transferFrom()` on-chain. Main wallet AND stealth address hidden on BaseScan — only relayer appears as `from`. Two send modes: **Stealth Send** (private, via relayer) + **Deposit** (main wallet → own stealth, entry point).
- **Send (ETH)**: ✅ — via PrivacyRelayer `relayAndAnnounce`. Customer's EOA never appears as `msg.sender`.
- **Receive**: ✅ — self-custodial stealth address generation in browser. Recycling icon creates fresh addresses on demand. All historical addresses stored in localStorage archive (`upl:stealth-archive:<wallet>`). No server-side private key storage.
- **USDC + ETH balance reads**: ✅ — raw `fetch()` reader (`balance-reader.js`) bypasses ethers CORS failures. Multi-RPC fallback (publicnode, blastapi, 1rpc). Reads across ALL archive addresses, sums total private balance.
- **Rotating relayer**: ✅ — relayer auto-rotates every 100 transactions. GasTreasury contract auto-funds each new relayer with 0.00002 ETH. No single wallet accumulates suspicious volume.
- **GasTreasury**: ✅ — deployed at `0xa95942e4176ece411764af08e35756b0ff23a76c`. Funded with 0.00096 ETH (~4,800 private transactions).
- **Native Swap (Core tile)**: ✅ — `NativePrivateSwap` vault. 0 third-party AMM hop.
- **Multi-DEX Swap (PrivateDeFi)**: ✅ — Aerodrome V2 + Uniswap V3 wrappers.
- **PrivacyPool**: ✅ — multi-denom, Poseidon Merkle depth 20, Groth16 verifier.
- **Confidential Notes (P2)**: ✅ — `confidential_notes.circom` circuit (4 public signals, recipient as private input). `ConfidentialNotes.sol` + verifier deployed. Zero-value ZK proof transactions — no USDC moves between users.
- **Transaction History**: ✅ — sealed with AES-256-GCM; backend stores ciphertext only.
- **Sui mainnet**: ✅ at parity.
- **Solana**: 🔒 PAUSED — needs ~3 SOL.

**Money spent total ≈ $13** (deployer ETH gas + vault USDC + treasury ETH + test transactions).

---

## Progress per phase

```
P0  Security + cleanup              ████████████████ 100% ✅ DONE
P1  EVM contracts on Base           ████████████████ 100% ✅ DONE
P2  Sui mainnet + ConfidentialNotes ████████████████ 100% ✅ DONE
P2.9 Sui/Base parity                ████████████████ 100% ✅ DONE
P2.9.7 Base atomic relay+announce   ████████████████ 100% ✅ DONE
P2.10 Solana (SVM) parity           ███████████░░░░░  72% 🔒 PAUSED
P3  Real ZK (Privacy Pool, Path B)  ████████████████ 100% ✅ DONE
P4  Pools + DeFi privacy            ████████████████ 100% ✅ DONE
P5  USDC sender-hiding (permit)     ████████████���███ 100% ✅ DONE
P5.1 Rotating relayer + GasTreasury ████████████████ 100% ✅ DONE
P5.2 Private Swap (relayer liquidity)████████████████ 100% ✅ DONE
P6  Amount hiding (notes built,     ████░░░░░░░░░░░░  25% BUILT — awaiting merge
     not merged)
```

---

## Live addresses (Base mainnet, chainId 8453)

| Contract | Address | Note |
|---|---|---|
| **PrivacyRelayer** | `0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42` | ETH relay + setRelayer for rotation |
| **Current relayer hot wallet** | `0xeE608e6C9C5C630fA868d3c14CB3158e048EeB3f` | Funded with 0.00002 ETH from treasury |
| **GasTreasury** | `0xa95942e4176ece411764af08e35756b0ff23a76c` | Auto-funds rotating relayers; 0.00094 ETH remaining |
| **StealthAddressRegistry** | `0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1` | Live announcement log |
| **Groth16Verifier** | `0x838b7c20b1a97cAA6379542d03983b4571275679` | snarkjs-generated |
| **PrivacyPool (multi-denom)** | `0x3F0b23Aca0624981a503e8f042db2F3884D0C89C` | 3 denoms: 0.01 / 0.1 / 1 ETH |
| **ConfidentialNotes** | `0x305d11e1877e2ACB928FdeFe7d94c10692beBCaC` | Zero-value ZK note creation |
| **ConfidentialNotesVerifier** | `0x4F4cEC449297975c5b46347dB818b03dEe813aE0` | Groth16 verifier (4 public signals) |
| **AerodromePrivacyWrapper** | `0xe896e6f51af137c32db7eb4e3b2de795d392a646` | 4-field Route struct + factory |
| **UniswapPrivacyWrapper** | `0x9C30cdCd73347BF18A5bD424C37E5714e2606362` | opt-in 3rd-party |
| **NativePrivateSwap** | `0x582c57a7ba6e7758e75dc5334a5e8ff096515d09` | Core Private Swap tile |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 decimals |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Canonical (not used currently) |

**Deployer / Owner:** `0x3f44A6451439673D95082A1337045a25ec275394`

---

## Privacy on BaseScan — what IS and IS NOT hidden

| Vector | Hidden? | How |
|---|---|---|
| Customer's EOA as `msg.sender` (USDC Send) | ✅ | EIP-2612 permit + relayer submits `transferFrom` |
| Customer's stealth as `from` (USDC Send) | ✅ | Relayer is `msg.sender`; stealth only signs permit off-chain |
| Customer's EOA as `msg.sender` (ETH Send) | ✅ | `relayAndAnnounce` — hot wallet fronts the tx |
| Recipient identity | ✅ | EIP-5564 stealth address |
| Sender identity (who initiated) | ✅ | Relayer hot wallet rotates every 100 tx |
| Memo / encrypted body | ✅ | AES-256-GCM wallet-derived seal |
| History row contents | ✅ | Ciphertext only on backend |
| Deposit↔withdraw link (PrivacyPool) | ✅ | Groth16 + Poseidon ZK proof |

### What's NOT hidden yet

| Vector | Visible | Plan |
|---|---|---|
| **Amount** | Visible on ERC20 Transfer event | **P6 — next target**: confidential notes system (already built + deployed, needs frontend integration) |
| PrivacyPool ceremony | Self-run 1-party | MPC upgrade path documented |

---

## Next steps

### P6 — Amount hiding (NEXT)
- `ConfidentialNotes.sol` + `confidential_notes.circom` already deployed on Base
- Circuit: 4 public signals (nullifierHash, newCommitment, encryptedAmount, root) — recipient is PRIVATE input
- Zero-value ZK proof transactions: no USDC moves between users on-chain
- Need: frontend integration to generate proofs in browser + call `createNote()`
- Result: amount hidden between Privacy Cloak users

### P7 — Ethereum mainnet expansion
- Same contracts deploy to Ethereum mainnet (chainId 1)
- Same relayer + GasTreasury pattern
- Higher gas costs — need more ETH in treasury
- PrivacyPool denomination adjustments for mainnet gas

---

## Key architecture decisions

1. **No vault, no custodial holding** — USDC stays in the user's stealth until the moment it's moved via permit + transferFrom
2. **Self-custodial stealth** — private keys derived in browser from wallet signature, stored in localStorage only, never on server
3. **Rotating relayer** — changes every 100 tx so no single address accumulates billions
4. **GasTreasury** — one funding point, auto-distributes gas to new relayers
5. **Two send modes only** — Stealth Send (private) + Deposit (entry point). No direct-transfer fallback that would expose the main wallet.

---

## CI/CD

| Workflow | Trigger | Status |
|---|---|---|
| `foundry-build-test.yml` | push touching `contracts/**` | ✅ |
| `backend-tests.yml` | push touching `backend/**` | ✅ |
| `deploy-azure.yml` | push to main | ✅ auto-flips RELAYER_PRIVATE_KEY |
| `move-build-test.yml` | push touching `contracts/sui/**` | ✅ |
| `solana-build-test.yml` | push touching `contracts/solana/**` | ✅ |
