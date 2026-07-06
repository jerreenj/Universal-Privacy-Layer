#!/bin/bash
# scripts/check_deployer.sh
# Quick sanity check on the Base deployer wallet before any mainnet broadcast.
# Reads DEPLOYER_PRIVATE_KEY from contracts/.env, never prints the key itself.
set -e

cd "$(dirname "$0")/.."

# Source just the deployer key, never log it.
PRIV=$(grep '^DEPLOYER_PRIVATE_KEY=' contracts/.env | cut -d= -f2-)
[ -z "$PRIV" ] && { echo "no DEPLOYER_PRIVATE_KEY in contracts/.env"; exit 1; }

CAST=/mnt/c/Users/AGBS\ Studio/.foundry/bin/cast.exe

ADDR=$("$CAST" wallet address --private-key "$PRIV" 2>/dev/null)
echo "DEPLOYER_ADDRESS=$ADDR"
echo
echo "NONCE=$("$CAST" nonce "$ADDR" --rpc-url https://mainnet.base.org 2>/dev/null)"
echo "BALANCE_ETH=$("$CAST" balance "$ADDR" --rpc-url https://mainnet.base.org --ether 2>/dev/null)"
echo "GAS_GWEI=$("$CAST" gas-price --rpc-url https://mainnet.base.org --gwei 2>/dev/null)"
echo
echo "BLOCK_BASE_LATEST=$("$CAST" block-number --rpc-url https://mainnet.base.org 2>/dev/null)"
