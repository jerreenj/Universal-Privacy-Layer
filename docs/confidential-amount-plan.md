# Privacy Cloak — Confidential Amount Layer (P2)
## Arcium-Style FHE-ZK Hybrid on Base, Solana, and Sui

### The Problem
USDC on Base is a standard ERC20. Every `transfer()` emits a plaintext `Transfer(from, to, amount)` event. We cannot modify USDC's contract. Items 1-4 (sender, recipient, destination, link) are already hidden via stealth addresses + relayer. Item 5 (amount) remains visible.

### The Solution
Build a **confidential balance layer** on Base — not a new token, not a pool, not a wrapper token users have to adopt. Arcium proved this model works on Solana. We adapt it to EVM.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    BASE CHAIN (L2)                       │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │  USDC        │    │  ConfidentialVault           │   │
│  │  (Coinbase)  │    │  (our contract)              │   │
│  │              │    │                              │   │
│  │  transfer()  │◄──►│  - encryptedBalance[addr]    │   │
│  │  emits       │    │  - noteCommitments[]         │   │
│  │  plaintext   │    │  - nullifierHashes[]         │   │
│  │  amount      │    │  - Groth16 verifier          │   │
│  └──────────────┘    │  - flash loan integration    │   │
│                      └──────────────────────────────┘   │
│                              │                           │
│  ┌──────────────┐    ┌───────┴───────────────────────┐  │
│  │  Aave V3     │    │  BatchSwapRouter              │  │
│  │  (flash loan)│◄──►│  (our contract)               │  │
│  │  free liquidity  │  - collects encrypted intents  │  │
│  │              │    │  - flash loans from Aave      │  │
│  └──────────────┘    │  - batch swaps on Uniswap     │  │
│                      │  - distributes to stealth     │  │
│  ┌──────────────┐    │    addresses                  │  │
│  │  Uniswap V3  │◄──►│  - repays flash loan          │  │
│  │  (liquidity) │    │  - all in one tx              │  │
│  └──────────────┘    └──────────────────────────────┘  │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │  PrivacyRelayer │ │  Groth16 Verifier            │   │
│  │  (hot wallet)│───►│  (already deployed)          │   │
│  │  broadcasts  │    │  verifies ZK proofs          │   │
│  │  proofs      │    │  without seeing amounts      │   │
│  └──────────────┘    └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

         ┌─────────────────────────────────┐
         │         OFF-CHAIN (BROWSER)      │
         │                                  │
         │  1. Generate ZK proof            │
         │     (amount is private input)    │
         │  2. Sign EIP-712 intent          │
         │  3. Send to relayer              │
         │  4. Relayer broadcasts on Base   │
         │                                  │
         │  Circuit: withdraw.circom        │
         │  Extended with:                  │
         │    - variable amount (private)   │
         │    - range proof (amt > 0)       │
         │    - balance proof (amt <= bal)  │
         │    - recipient encryption        │
         └─────────────────────────────────┘
```

### How All 5 Points Are Hidden

| # | Item | How it's hidden | Visible on BaseScan? |
|---|------|----------------|---------------------|
| 1 | Who sent it | Relayer hot wallet is msg.sender. Customer signs EIP-712 intent off-chain. | No |
| 2 | Where it went | One-time stealth address (EIP-5564 ECDH). Unlinkable to any prior address. | No (address visible but unlinkable) |
| 3 | Who was recipient | Stealth address derived from recipient's view key. Only recipient can scan + claim. | No |
| 4 | Who was sender | Customer EOA never broadcasts. Relayer submits the proof. | No |
| 5 | The amount | ZK proof with amount as private input. EVM verifies proof, never sees plaintext. Encrypted commitment stored on-chain. | **No** |

### How Liquidity Works (Zero Capital)

**Problem:** We need USDC liquidity to execute swaps, but we have no money.

**Solution:** Flash loans from Aave V3 (already deployed on Base at `0xA238Dd80C259a72e81d7e4664a980159B1977032`).

**Flash loan flow:**
1. Multiple users submit encrypted swap intents to our BatchSwapRouter
2. BatchSwapRouter flash-loans the total USDC needed from Aave V3 (zero cost — borrow and repay in same tx)
3. BatchSwapRouter swaps on Uniswap V3 (uses Uniswap's existing liquidity — millions in pools)
4. Outputs distributed to each user's stealth address as encrypted commitments
5. Flash loan repaid from the users' input amounts
6. All in one atomic transaction

**What Uniswap sees:** "Privacy Cloak contract swapped 500 USDC total" — one number, no individual amounts, no user identities.

**What each user sees:** their private amount, sent to their stealth address, fully hidden.

**Cost to us:** gas only (~$0.01 per batch on Base). No capital locked. No liquidity pool to fund.

**Alternative liquidity sources (if Aave isn't enough):**
- Uniswap V3 flash swaps (same concept, different provider)
- Balancer flash loans (already on Base)
- Multiple providers in fallback chain

### How It Differs from a Pool/Tornado Cash

| Feature | Tornado Pool (what we rejected) | Confidential Balance Layer (what we're building) |
|---------|-------------------------------|--------------------------------------------------|
| Denominations | Fixed (0.1 ETH only) | Variable (any amount) |
| User experience | Deposit → wait → withdraw (3 steps) | Send directly (1 step, like normal transfer) |
| Anonymity set | Required (needs many depositors for privacy) | Not required (direct sender→recipient, ZK proves validity) |
| Token | Locked ETH in pool | USDC stays as USDC, balance tracked as encrypted commitment |
| Swap | Not supported | Native batch swap with flash loan liquidity |
| Feels like | Depositing into a vault | Sending a private payment |

### How It's Like Arcium on Solana

| Arcium (Solana) | Privacy Cloak (Base) |
|----------------|---------------------|
| Solana program with encrypted state | EVM contract with encrypted state |
| ZK proofs validate transitions | Groth16 proofs validate transitions (same verifier we already have deployed) |
| Compute network processes encrypted ops off-chain | Browser generates proof off-chain, relayer broadcasts |
| No new token — encrypted balances | No new token — encrypted commitments over USDC |
| On Solana | On Base (same EVM, same USDC) |

### What We Already Have (Reuse)

| Component | Status | Location |
|-----------|--------|----------|
| Groth16 verifier | Deployed on Base | `0x838b7c20b1a97cAA6379542d03983b4571275679` |
| PrivacyRelayer | Deployed + funded | `0xCea5b3dD22c5306dEF78767b27Ec9E276c5e1C42` |
| StealthAddressRegistry | Deployed | `0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1` |
| circom + snarkjs toolchain | Working | `contracts/circuits/` |
| Poseidon hash circuit | Working | `contracts/src/PoseidonT3.sol` |
| Relayer backend | Working | `backend/server.py` `/relayer/submit` |
| EIP-712 intent signing | Working | Frontend `signTypedData` |
| Proxy wallet + stealth derivation | Working | `frontend/src/lib/stealth-proxy.js` |
| ZK proof generation in browser | Working | `frontend/src/lib/zk-browser.js` |
| Flash loan target (Aave V3) | Deployed on Base | `0xA238Dd80C259a72e81d7e4664a980159B1977032` |
| DEX liquidity (Uniswap V3) | Deployed on Base | Already integrated via our wrapper |

### What We Need to Build New

#### 1. ZK Circuit — Variable Amount Notes (`confidential_transfer.circom`)
- **Private inputs:** nullifier, secret, amount, blinding factor, recipient view key
- **Public inputs:** commitment, nullifier hash, encrypted amount, root
- **Range proof:** prove `amount > 0` and `amount <= sender_balance` without revealing either
- **Encryption:** amount encrypted to recipient's view key (only recipient can decrypt)
- **Merkle proof:** prove the sender's note exists in the tree

**Timeline:** 1-2 days (extend existing `withdraw.circom`)

#### 2. ConfidentialVault Contract (`ConfidentialVault.sol`)
- Encrypted balance mapping (commitments, not plaintext)
- `confidentialTransfer(encryptedAmount, commitment, nullifierHash, proof)` — ZK proof verified, no plaintext amount anywhere
- `batchSwapWithFlashLoan(intents[], proof)` — flash loan → Uniswap → distribute encrypted outputs
- Integrates with existing Groth16 verifier + PrivacyRelayer

**Timeline:** 2-3 days

#### 3. BatchSwapRouter Contract (`BatchSwapRouter.sol`)
- Collects encrypted swap intents from multiple users
- Flash loans total from Aave V3
- Executes batch swap on Uniswap V3
- Distributes outputs as encrypted commitments to stealth addresses
- Repays flash loan in same tx
- Zero capital required

**Timeline:** 1-2 days

#### 4. Frontend Integration
- Extend `SwapContent.jsx` with confidential amount mode
- Browser generates ZK proof with amount as private input
- Routes through relayer (sender hidden)
- Output to stealth address (recipient hidden)
- Amount encrypted in proof (amount hidden)

**Timeline:** 1-2 days

#### 5. Solana + Sui Extension (Post-Base)
- Solana: adapt the Arcium model directly (they already proved it works)
- Sui: adapt for Move VM (encrypted object model)
- Same architecture, different VM

**Timeline:** Post-Base pilot

### Total Timeline for Base: 5-7 days

| Day | Task |
|-----|------|
| 1-2 | ZK circuit: variable amounts + range proofs + encryption |
| 2-3 | Trusted setup ceremony (snarkjs groth16) |
| 3-5 | ConfidentialVault + BatchSwapRouter contracts |
| 5-6 | Forge tests (deposit, transfer, batch swap, flash loan) |
| 6-7 | Frontend wiring + relayer integration |
| 7 | Deploy on Base mainnet + verify |

### The Boundary (Honest Disclosure)

**What's absolutely hidden:**
- Any transfer between two Privacy Cloak users — sender, recipient, AND amount
- Any swap through our BatchSwapRouter — individual amounts hidden, only batch total visible to DEX
- All on Base, no other chain needed

**What's visible at the boundary (cannot be avoided):**
- When a user deposits real USDC into the ConfidentialVault → USDC.transfer fires (amount visible, but sender is proxy/relayer, no identity)
- When a user withdraws real USDC from the ConfidentialVault → USDC.transfer fires (amount visible, but recipient is stealth address, no identity)
- These boundary amounts are **detached numbers** — visible but not linked to any person

### Why This Works on Base (Not a Separate Chain)

1. **ZK proofs run on any EVM** — Base already runs our Groth16 verifier
2. **Encrypted state is just hashes** — the EVM stores commitments (bytes32), not plaintext. This is legal EVM storage.
3. **Flash loans provide liquidity** — Aave V3 is already on Base, no capital needed
4. **Uniswap provides swap liquidity** — already on Base, millions in pools
5. **Relayer provides sender privacy** — already deployed and funded
6. **Stealth addresses provide recipient privacy** — already working

**No new chain. No new token. No bridge. No capital. Same Base, same USDC, full privacy.**

### Comparison: What Each Chain Gets

| Chain | Items 1-4 (done) | Item 5 (this plan) | Liquidity |
|-------|------------------|--------------------|-----------| 
| **Base** | ✓ Hidden | ✓ Hidden (this build) | Aave V3 flash loans + Uniswap V3 |
| **Solana** | ✓ Hidden | Adapt Arcium model | Solana DEX pools (Jupiter aggregator) |
| **Sui** | ✓ Hidden | Adapt for Move VM (encrypted objects) | Sui DEX pools (Cetus, DeepBook) |
