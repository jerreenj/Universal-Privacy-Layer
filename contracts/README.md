# PrivacyCloak — Smart Contracts

Solidity contracts deployed across 7 EVM chains.

## Contracts

| Contract | Description |
|----------|-------------|
| `PrivacyRelayer.sol` | On-chain relayer for gasless meta-transactions |
| `StealthAddressRegistry.sol` | Stealth address announcement registry |
| `UPLVerifier.sol` | Main ZKP verifier (wraps Groth16Verifier) |
| `Groth16Verifier.sol` | Auto-generated Circom/snarkjs verifier |
| `UniswapPrivacyWrapper.sol` | Uniswap V3 router privacy wrapper |

## Deployed Addresses

See `deployed_*.json` files for each chain's contract addresses.

## Deployer Wallet
`0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4`

Fund with gas tokens before deploying. Mnemonic must be set as `MNEMONIC` environment variable — never hardcode it.

## Deploy
```bash
export MNEMONIC="your twelve word seed phrase here"
python deploy.py --chain base
python deploy.py --chain arbitrum
python deploy.py --chain polygon
```

## Chains
- Base, Arbitrum, Polygon, Optimism, BNB Chain, Avalanche, Hyperliquid
