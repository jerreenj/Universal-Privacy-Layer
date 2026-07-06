#!/bin/bash
# scripts/add_denominations.sh — owner-only cast send calling
# PrivacyPool.addDenomination(d) TWICE on the live Base mainnet pool,
# to seed 0.01 ETH + 1 ETH alongside the existing 0.1 ETH seed.
#
# Pool (multi-denom): 0x3F0b23Aca0624981a503e8f042db2F3884D0C89C
# Owner: 0x3f44A6451439673D95082A1337045a25ec275394 (= DEPLOYER_PRIVATE_KEY)
#
# Real-gas cost ~0.0000005 ETH each call (~USD 0.0015 each).
set -e

cd "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts"
export BASE_RPC_URL=https://mainnet.base.org
export DEPLOYER_PRIVATE_KEY=$(grep '^DEPLOYER_PRIVATE_KEY=' .env | cut -d= -f2-)

CAST="/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe"
POOL=0x3F0b23Aca0624981a503e8f042db2F3884D0C89C
D_001=10000000000000000          # 0.01 ETH
D_100=1000000000000000000         # 1 ETH

echo "== pre-state: isDenominationEnabled =="
$CAST call $POOL 'isDenominationEnabled(uint256)(bool)' "$D_001" --rpc-url $BASE_RPC_URL || true
$CAST call $POOL 'isDenominationEnabled(uint256)(bool)' "$D_100" --rpc-url $BASE_RPC_URL || true

echo
echo "== preflight: balance + nonce =="
ADDR=$($CAST wallet address --private-key "$DEPLOYER_PRIVATE_KEY" 2>/dev/null)
BAL=$($CAST balance $ADDR --rpc-url $BASE_RPC_URL --ether 2>/dev/null)
NCE=$($CAST nonce $ADDR --rpc-url $BASE_RPC_URL 2>/dev/null)
GP=$($CAST gas-price --rpc-url $BASE_RPC_URL --gwei 2>/dev/null)
echo "deployer : $ADDR"
echo "balance  : $BAL ETH"
echo "nonce    : $NCE  (will increment by 1 per call below)"
echo "gas      : $GP gwei"

echo
echo "== addDenomination(0.01 ETH) ==" && $CAST send $POOL 'addDenomination(uint256)' "$D_001" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url $BASE_RPC_URL --json | head -60
echo
echo "== addDenomination(1 ETH) ==" && $CAST send $POOL 'addDenomination(uint256)' "$D_100" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url $BASE_RPC_URL --json | head -60

echo
echo "== post-state: isDenominationEnabled =="
$CAST call $POOL 'isDenominationEnabled(uint256)(bool)' "$D_001" --rpc-url $BASE_RPC_URL
$CAST call $POOL 'isDenominationEnabled(uint256)(bool)' "$D_100" --rpc-url $BASE_RPC_URL
$CAST call $POOL 'getDenominationList()(uint256[])' --rpc-url $BASE_RPC_URL
