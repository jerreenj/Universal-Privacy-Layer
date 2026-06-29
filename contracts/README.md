# UPL EVM Contracts (Foundry)

Foundry project for the Universal Privacy Layer's on-chain EVM contracts.
P1.4 of the roadmap — "make contracts real": the EVM side now has a real
toolchain (build + test + fmt gate) to match the Sui Move package under
`contracts/sui/`.

## Contracts

| File | Role |
|------|------|
| `src/StealthAddressRegistry.sol` | EIP-5564-style on-chain announcement registry for stealth transfers |
| `src/PrivacyRelayer.sol` | Gas-only meta-tx forwarder (`onlyRelayer`); the user's wallet never appears as `msg.sender` |
| `src/UniswapPrivacyWrapper.sol` | Privacy wrapper routing Uniswap V3 swaps through the stealth layer |

## Build & test

Dependencies (`forge-std`, `openzeppelin-contracts`) are **not committed** —
fetch them first:

```shell
forge install
forge build
forge test -vvv
```

## Format

```shell
forge fmt
forge fmt --check   # CI gate
```

## Toolchain

- Solidity `^0.8.20` (pinned via `foundry.toml` `solc = "0.8.20"`)
- Foundry (install with `foundryup` — see https://book.getfoundry.sh/)
- OpenZeppelin Contracts v5 (fetched by `forge install`; remapped via
  `@openzeppelin/` in `foundry.toml`)

## Deploy to Base Mainnet (P1.6)

The deploy is a single command via `scripts/deploy_base.sh` (from the repo
root). It deploys all three contracts to Base mainnet (chainId 8453) and writes
`contracts/deployed_base.json`, which the backend auto-reads at startup.

### Prerequisites

1. Install Foundry: `foundryup`
2. Fund a deployer wallet with ETH on Base mainnet
3. Copy `contracts/.env.example` to `contracts/.env` and fill in:
   - `BASE_RPC_URL` — Base mainnet RPC (default: `https://mainnet.base.org`)
   - `DEPLOYER_PRIVATE_KEY` — funded deployer wallet (becomes owner + relayer)
   - `FEE_RECIPIENT` — **IMMUTABLE after deploy** (no setter on the wrapper)
   - `BASESCAN_API_KEY` — optional, for contract verification

### Run the deploy

```shell
# From the repo root:
export BASE_RPC_URL=https://mainnet.base.org
export DEPLOYER_PRIVATE_KEY=0x...
export FEE_RECIPIENT=0x...    # choose carefully — cannot be changed later
bash scripts/deploy_base.sh
```

The script will:
- Preflight-check forge/cast, env vars, and the deployer's funded balance
- Print a deploy summary and require you to type `DEPLOY` to confirm
- Broadcast `Deploy.s.sol` (deploys all 3 contracts, writes `deployed_base.json`)
- Enrich the manifest with `deployedAt` (UTC) + `commit` (git sha) provenance
- Optionally verify on Basescan if `BASESCAN_API_KEY` is set

### Constructor args

| Contract | Args | Notes |
|----------|------|-------|
| `StealthAddressRegistry` | none | No owner, permissionless mailbox |
| `PrivacyRelayer` | none | Deployer becomes `owner` AND `relayer`; rotate via `setRelayer()` post-deploy |
| `UniswapPrivacyWrapper` | `swapRouter`, `WETH`, `feeRecipient` | All three are **immutable**; `feeRate` is fixed at 5 bps (no setter) |

Defaults (overridable via env):
- `SWAP_ROUTER` = `0xE592427A0AEce92De3Edee1F18E0157C05861564` (canonical V3 SwapRouter — **NOT SwapRouter02**; the contract's `ISwapRouter` struct has a `deadline` field)
- `WETH` = `0x4200000000000000000000000000000000000006` (Base WETH9)

### After deploy

The backend's `_load_deployed_addresses()` reads `deployed_base.json` at import
time and overrides the static placeholder addresses in `UPL_CONTRACTS` — no
endpoint changes needed. Restart the backend (or trigger an Azure redeploy)
for it to pick up the new addresses.
