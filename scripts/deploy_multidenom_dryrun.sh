#!/bin/bash
# scripts/deploy_multidenom_dryrun.sh
# Dry-run of the P4.1 multi-denom PrivacyPool redeploy against Base mainnet.
# Loads contracts/.env, then runs `forge script` WITHOUT --broadcast so we
# just predict addresses + gas usage. NEVER prints DEPLOYER_PRIVATE_KEY in
# any output; only its length + first/last few chars for sanity.
set -e

cd "$(dirname "$0")/.."

# Load ONLY the env vars this driver needs (avoids blanket-export of SUI key).
export BASE_RPC_URL=$(grep '^BASE_RPC_URL=' contracts/.env | cut -d= -f2-)
export DEPLOYER_PRIVATE_KEY=$(grep '^DEPLOYER_PRIVATE_KEY=' contracts/.env | cut -d= -f2-)
export FEE_RECIPIENT=$(grep '^FEE_RECIPIENT=' contracts/.env | cut -d= -f2-)

[ -z "$BASE_RPC_URL" ]         && { echo "no BASE_RPC_URL"; exit 1; }
[ -z "$DEPLOYER_PRIVATE_KEY" ] && { echo "no DEPLOYER_PRIVATE_KEY"; exit 1; }
[ -z "$FEE_RECIPIENT" ]        && { echo "no FEE_RECIPIENT"; exit 1; }

# Make sure the leading 0x is intact (Windows->bash sometimes loses it).
[ "${DEPLOYER_PRIVATE_KEY:0:2}" = "0x" ] || { echo "PK missing 0x prefix"; exit 1; }
case "${DEPLOYER_PRIVATE_KEY#0x}" in
  *[!0-9a-fA-F]*) echo "PK non-hex"; exit 1 ;;
esac

# Foundry bin in PATH (forge + cast must be reachable for `forge script`).
FORGE_BIN="/mnt/c/Users/AGBS Studio/.foundry/bin/forge.exe"
export PATH="/mnt/c/Users/AGBS Studio/.foundry/bin:$PATH"
command -v forge >/dev/null 2>&1 || [ -x "$FORGE_BIN" ] || { echo "forge binary missing at $FORGE_BIN"; exit 1; }

# Seed three canonical seed denominations: 0.01 / 0.1 / 1 ETH.
export POOL_DENOMINATIONS_WEI="10000000000000000,100000000000000000,1000000000000000000"

echo "== sanity =="
echo "PK: 0x${DEPLOYER_PRIVATE_KEY:2:4}...${DEPLOYER_PRIVATE_KEY: -4} (len=${#DEPLOYER_PRIVATE_KEY})"
echo "FR: $FEE_RECIPIENT"
echo "RPC: $BASE_RPC_URL"
echo "DENOMS: $POOL_DENOMINATIONS_WEI"
echo

cd contracts
echo "== forge script dry-run =="
"$FORGE_BIN" script script/Deploy.s.sol \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
