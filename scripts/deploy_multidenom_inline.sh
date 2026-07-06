#!/bin/bash
cd "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts"
export BASE_RPC_URL=https://mainnet.base.org
export DEPLOYER_PRIVATE_KEY=$(grep "^DEPLOYER_PRIVATE_KEY=" .env | cut -d= -f2-)
export FEE_RECIPIENT=$(grep "^FEE_RECIPIENT=" .env | cut -d= -f2-)
# Multi-denom seed (will be picked up by vm.envOr only if .env has the var;
# otherwise falls back to the single 0.1 ETH back-compat default inside the
# deploy script).
export POOL_DENOMINATION_WEI=100000000000000000

echo "DEPLOYER: 0x$(echo $DEPLOYER_PRIVATE_KEY | cut -c3-6)...$(echo $DEPLOYER_PRIVATE_KEY | rev | cut -c1-4)"
echo "FR:       $FEE_RECIPIENT"
echo "RPC:      $BASE_RPC_URL"
echo "Gonna broadcast..."

/mnt/c/Users/AGBS\ Studio/.foundry/bin/forge.exe script script/Deploy.s.sol \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

echo "Forge done exit=$?"
