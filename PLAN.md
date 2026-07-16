# Universal Privacy Layer — Project Plan

**Live:** [privacycloak.in](https://privacycloak.in) · **Repo:** github.com/jerreenj/Universal-Privacy-Layer

**Last updated:** 2026-07-16

---

## TL;DR — what's done

- **Send (USDC)**: ✅ — Stealth Send via EIP-2612 permit + relayer. Stealth signs permit locally (no wallet popup), relayer submits permit + transferFrom. Main wallet AND stealth hidden on BaseScan. Two modes: Stealth Send + Deposit.
- **Send (ETH)**: ✅ — Same two-mode system as USDC. Deposit (main → stealth) + Stealth Send (stealth → recipient, signed locally, main wallet hidden).
- **Receive (USDC + ETH)**: ✅ — Self-custodial stealth address generation in browser. Recycling icon creates fresh addresses. All addresses in localStorage archive. No server-side private key storage.
- **Private Swap**: ✅ — Curve Finance direct swap via CurveSwapRouter. USDC↔ETH, zero operator capital. Tested on-chain both directions. Privacy: only relayer + CurveSwapRouter appear on BaseScan.
- **USDC + ETH balance reads**: ✅ — Raw fetch() reader, multi-RPC fallback, parallel reads across all stealth addresses. Loads at same time as public balance.
- **Rotating relayer**: ✅ — Auto-rotates every 100 tx. GasTreasury auto-funds new relayers.
- **GasTreasury**: ✅ — Deployed, funded, auto-funds relayer rotations.
- **Hidden Amount (P6)**: ✅ — "Hidden Amount" toggle in Send + Swap. When ON, creates a confidential note (amount hidden on BaseScan) + auto-settles (real USDC delivered, amount visible but unlinkable). Two BaseScan links per transaction. Toggle defaults OFF — when OFF, everything works exactly as before.
- **Transaction History**: ✅ — AES-256-GCM sealed, backend stores ciphertext only.
- **Sui mainnet**: ✅ at parity.
- **Solana**: 🔒 PAUSED — needs ~3 SOL.

**Money spent total ≈ $15** (deployer ETH gas + treasury ETH + test transactions).

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
P5  USDC sender-hiding (permit)     ████████████████ 100% ✅ DONE
P5.1 Rotating relayer + GasTreasury ████████████████ 100% ✅ DONE
P5.2 Private Swap (Curve direct)    ████████████████ 100% ✅ DONE
P5.3 ETH Send (Deposit + Stealth)   ████████████████ 100% ✅ DONE
P6  Amount hiding (hidden toggle)   ████████████████ 100% ✅ DONE — toggle defaults OFF
P7  Ethereum mainnet expansion      ░░░░░░░░░░░░░░░░   0% FUTURE
```

---

## Live addresses (Base mainnet, chainId 8453)

| Contract | Address | Note |
|---|---|---|
| **PrivacyRelayer** | `0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42` | ETH relay + setRelayer for rotation |
| **Current relayer hot wallet** | `0xeE608e6C9C5C630fA868d3c14CB3158e048EeB3f` | Funded from treasury |
| **GasTreasury** | `0xa95942e4176ece411764af08e35756b0ff23a76c` | Auto-funds rotating relayers |
| **CurveSwapRouter** | `0xdD7F4A1557eF98Aa6B14C8EbD50acA6d81C8659a` | USDC↔ETH swap via Curve Finance |
| **StealthAddressRegistry** | `0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1` | Live announcement log |
| **Groth16Verifier** | `0x838b7c20b1a97cAA6379542d03983b4571275679` | snarkjs-generated |
| **PrivacyPool (multi-denom)** | `0x3F0b23Aca0624981a503e8f042db2F3884D0C89C` | 3 denoms: 0.01 / 0.1 / 1 ETH |
| **ConfidentialNotes** | `0x305d11e1877e2ACB928FdeFe7d94c10692beBCaC` | Zero-value ZK note creation |
| **ConfidentialNotesVerifier** | `0x4F4cEC449297975c5b46347dB818b03dEe813aE0` | Groth16 verifier (4 public signals) |
| **Curve Pool (USDC/WETH)** | `0xF2EcC3A2dEFB4ECC1Ac510CBbc405a539A990BE4` | Curve Finance — swap liquidity |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 decimals |
| WETH | `0x4200000000000000000000000000000000000006` | Wrapped ETH (unwrap 1:1 to ETH) |

**Deployer / Owner:** `0x3f44A6451439673D95082A1337045a25ec275394`

---

## Privacy on BaseScan — what IS and IS NOT hidden

| Vector | Hidden? | How |
|---|---|---|
| Customer's EOA as `msg.sender` (USDC Send) | ✅ | EIP-2612 permit + relayer submits `transferFrom` |
| Customer's stealth as `from` (USDC Send) | ✅ | Relayer is `msg.sender`; stealth only signs permit off-chain |
| Customer's EOA as `msg.sender` (ETH Send) | ✅ | Stealth sends directly; main wallet never involved |
| Customer's EOA as `msg.sender` (Swap) | ✅ | Relayer submits CurveSwapRouter call |
| Recipient identity | ✅ | EIP-5564 stealth address |
| Sender identity (who initiated) | ✅ | Relayer hot wallet rotates every 100 tx |
| Memo / encrypted body | ✅ | AES-256-GCM wallet-derived seal |
| History row contents | ✅ | Ciphertext only on backend |
| Deposit↔withdraw link (PrivacyPool) | ✅ | Groth16 + Poseidon ZK proof |
| Swap counterparty (Curve) | ✅ | CurveSwapRouter wraps the Curve call |

### What's NOT hidden yet

| Vector | Visible | Plan |
|---|---|---|
| **Amount** | Visible on ERC20 Transfer event | **P6**: confidential notes system (built + deployed, awaiting merge) |
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
