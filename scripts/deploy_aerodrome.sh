#!/bin/bash
# scripts/deploy_aerodrome.sh — broadcast ONLY the AerodromePrivacyWrapper
# to Base. Costs ~USD 0.005.
set -e

cd "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts"

export BASE_RPC_URL=https://mainnet.base.org
export DEPLOYER_PRIVATE_KEY=$(grep "^DEPLOYER_PRIVATE_KEY=" .env | cut -d= -f2-)
export FEE_RECIPIENT=$(grep "^FEE_RECIPIENT=" .env | cut -d= -f2-)

echo "DEPLOYER:  0x$(echo "$DEPLOYER_PRIVATE_KEY" | cut -c3-6)...$(echo "$DEPLOYER_PRIVATE_KEY" | rev | cut -c1-4)"
echo "FR:        $FEE_RECIPIENT"
echo "RPC:       $BASE_RPC_URL"
echo
echo "== dry-run =="
/mnt/c/Users/AGBS\ Studio/.foundry/bin/forge.exe script script/DeployAerodrome.s.sol \
  --rpc-url "$BASE_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
echo
echo "== broadcast =="
/mnt/c/Users/AGBS\ Studio/.foundry/bin/forge.exe script script/DeployAerodrome.s.sol \
  --rpc-url "$BASE_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast
