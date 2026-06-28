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
