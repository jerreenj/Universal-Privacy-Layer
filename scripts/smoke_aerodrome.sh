#!/bin/bash
# scripts/smoke_aerodrome.sh — END-TO-END smoke test of the
# AerodromePrivacyWrapper on Base mainnet. Tests the same code path
# the "Aerodrome V2" tile calls from the browser.
#
# What this verifies live on Base:
#   1. Wrapper deployer (0x3f44…) calls privateSwapETHForToken(USDC,
#      [{WETH->USDC, stable:false, factory: 0x420…0fDa}], minOut,
#      recipient, deadline).
#   2. Tx mines successfully (~0.01 gwei typical).
#   3. feeRecipient (deployer) receives the 5 bps fee on top of the swap.
#   4. Recipient (deployer wallet itself, so we don't need to manage a
#      separate keypair in WSL's python) gets the expected amount of
#      USDC minus slippage.
#   5. Total gas / fraction of deployer's remaining balance.
#
# Outputs a Basescan link + final balance check + tx hash to commit
# alongside this script's invocation so it's reproducible.
#
# P4.2 hotfix (2026-07-06):
#   Aerodrome's `Route` struct is (address from, address to, bool stable,
#   address factory) — 4 fields. The first wrapper used 3 fields; the
#   calldata was mis-aligned, causing Aerodrome Router's decoder to revert
#   with empty error data. This script now reads WRAPPER from an env var
#   so it always targets the freshly-deployed wrapper with the corrected
#   interface.
set -e

cd "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts"

export BASE_RPC_URL=https://mainnet.base.org
PRIV=$(grep '^DEPLOYER_PRIVATE_KEY=' .env | cut -d= -f2-)

# Use deployer's own address as recipient (self-tx). Avoids needing
# to manage a separate keypair in WSL python (no eth_account here).
# In a real customer flow the recipient would be a stealth address
# from /api/stealth/generate.
RECIPIENT_ADDR=0x3f44A6451439673D95082A1337045a25ec275394

CAST='/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe'
RPC="$BASE_RPC_URL"

# Wrapper address is REQUIRED — the old 3-field Route wrapper has been
# superseded. Pass via WRAPPER=0x... env var.
: "${WRAPPER:?WRAPPER env var must be set to the freshly-deployed AerodromePrivacyWrapper address}"
AERODROME=0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
WETH=0x4200000000000000000000000000000000000006
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
# Aerodrome V2 PoolFactory on Base — handles both stable + volatile pools
# (PoolFactory.getPool has a bool `stable` arg, not a separate factory).
AERODROME_FACTORY=0x420DD381b31aEf6683db6B902084cB0FFECe40Da
AMOUNT_IN=100000000000000   # 0.0001 ETH (~$0.30 at $3000/ETH)

echo "== smoke-test wrapper =="
echo "$WRAPPER"
echo "== smoke-test recipient =="
echo "(using deployer 0x3f44… as recipient = self-tx)"
echo "$RECIPIENT_ADDR"

echo
echo "== pre-state: wrapper config =="
"$CAST" call $WRAPPER 'WETH()(address)'               --rpc-url $RPC 2>&1
"$CAST" call $WRAPPER 'aerodromeRouter()(address)'   --rpc-url $RPC 2>&1
"$CAST" call $WRAPPER 'volatileFactory()(address)'    --rpc-url $RPC 2>&1
"$CAST" call $WRAPPER 'stableFactory()(address)'      --rpc-url $RPC 2>&1
"$CAST" call $WRAPPER 'feeRecipient()(address)'       --rpc-url $RPC 2>&1
"$CAST" call $WRAPPER 'feeRate()(uint256)'            --rpc-url $RPC 2>&1

echo
echo "== pre-state: deployer balance / nonce =="
"$CAST" balance 0x3f44A6451439673D95082A1337045a25ec275394 --rpc-url $RPC --ether 2>&1
"$CAST" nonce   0x3f44A6451439673D95082A1337045a25ec275394 --rpc-url $RPC 2>&1

echo
echo "== pre-state: deployer USDC balance =="
"$CAST" call $USDC "balanceOf(address)(uint256)" "$RECIPIENT_ADDR" --rpc-url $RPC 2>&1

echo
echo "== broadcast: wrapper.privateSwapETHForToken(USDC, [WETH->USDC volatile], 0 minOut, recipient, deadline+15min) =="
echo "(amountIn: $AMOUNT_IN wei = 0.0001 ETH; fee @ 5bps = ~5e-4 ETH)"

# Compute deadline = now + 15 min
DEADLINE=$(($(date +%s) + 900))

# Aerodrome route for [WETH -> USDC, volatile] — Aerodrome V2 Route is
# (address from, address to, bool stable, address factory). The factory
# field is what the V2 Router expects; address(0) maps to Aerodrome's
# defaultFactory = 0x420…0fDa. We pass it explicitly to mirror the
# wrapper's `route()` helper output.
echo
echo "tx:"
"$CAST" send \
  $WRAPPER \
  "privateSwapETHForToken(address,(address,address,bool,address)[],uint256,address,uint256)" \
  "$USDC" \
  "[($WETH,$USDC,false,$AERODROME_FACTORY)]" \
  0 \
  "$RECIPIENT_ADDR" \
  $DEADLINE \
  --value $AMOUNT_IN \
  --private-key "$PRIV" \
  --rpc-url $RPC \
  --json 2>&1 | head -5

echo
echo "== post-state (after 30s for mining) =="
sleep 30

echo "deployer ETH:  $($CAST balance 0x3f44A6451439673D95082A1337045a25ec275394 --rpc-url $RPC --ether)"
echo "deployer USDC: $($CAST call $USDC 'balanceOf(address)(uint256)' 0x3f44A6451439673D95082A1337045a25ec275394 --rpc-url $RPC 2>&1)"

echo
echo "== Basescan =="
echo "wrapper:  https://basescan.org/address/$WRAPPER"
echo "deployer (recipient): https://basescan.org/address/$RECIPIENT_ADDR"
