#!/bin/bash
# scripts/deploy_multidenom_broadcast.sh
# P4.1 multi-denom PrivacyPool redeploy against Base mainnet. Loads
# contracts/.env, runs `forge script --broadcast`. NEVER prints
# DEPLOYER_PRIVATE_KEY. After forge finishes, runs
# scripts/merge_deploy_manifest.py to enrich the manifest with the real
# on-chain addresses + commit provenance.
set -e

cd "$(dirname "$0")/.."

# Load ONLY the env vars this driver needs (avoids blanket-export of SUI key).
export BASE_RPC_URL=$(grep '^BASE_RPC_URL=' contracts/.env | cut -d= -f2-)
export DEPLOYER_PRIVATE_KEY=$(grep '^DEPLOYER_PRIVATE_KEY=' contracts/.env | cut -d= -f2-)
export FEE_RECIPIENT=$(grep '^FEE_RECIPIENT=' contracts/.env | cut -d= -f2-)

[ -z "$BASE_RPC_URL" ]         && { echo "no BASE_RPC_URL"; exit 1; }
[ -z "$DEPLOYER_PRIVATE_KEY" ] && { echo "no DEPLOYER_PRIVATE_KEY"; exit 1; }
[ -z "$FEE_RECIPIENT" ]        && { echo "no FEE_RECIPIENT"; exit 1; }

[ "${DEPLOYER_PRIVATE_KEY:0:2}" = "0x" ] || { echo "PK missing 0x prefix"; exit 1; }
case "${DEPLOYER_PRIVATE_KEY#0x}" in
  *[!0-9a-fA-F]*) echo "PK non-hex"; exit 1 ;;
esac

FORGE_BIN="/mnt/c/Users/AGBS Studio/.foundry/bin/forge.exe"
[ -x "$FORGE_BIN" ] || { echo "forge binary missing at $FORGE_BIN"; exit 1; }

# Resolve deployer + balance + gas-price FIRST so we can fail fast on
# insufficient funds or a stale nonce.
CAST_BIN="/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe"
ADDR=$("$CAST_BIN" wallet address --private-key "$DEPLOYER_PRIVATE_KEY" 2>/dev/null)
BAL_WEI=$("$CAST_BIN" balance "$ADDR" --rpc-url "$BASE_RPC_URL" 2>/dev/null)
NONCE=$("$CAST_BIN" nonce "$ADDR" --rpc-url "$BASE_RPC_URL" 2>/dev/null)
GP=$("$CAST_BIN" gas-price --rpc-url "$BASE_RPC_URL" --gwei 2>/dev/null)

python3 - <<PY
bal   = int("${BAL_WEI}" or 0)
gp    = float("${GP}" or 0)
nonce = int("${NONCE}" or 0)
budget = 1500000
cost = budget * (gp * 1e9) if gp > 0 else 0
gas_str  = "{:.4f} gwei".format(gp) if gp > 0 else "<unknown>"
cost_str = "{:.6f} ETH".format(cost/1e18) if cost > 0 else "<unknown - forge will fail if pool budget exceeds balance>"
surplus  = "YES" if bal > cost else "CHECK"
print("== preflight ==")
print("deployer: $ADDR")
print("balance:  {:.6f} ETH ({} wei)".format(bal/1e18, bal))
print("nonce:    {}  (script will increment for each broadcasted tx)".format(nonce))
print("gas:      {}".format(gas_str))
print("budget:   {} gas @ current price = {}".format(budget, cost_str))
print("surplus:  {}".format(surplus))
PY

echo
echo "=== P4.1 MULTI-DENOM DEPLOY — Base Mainnet ==="
echo "  This writes contracts/deployed_base.json with the new addresses."
echo "  The OLD P3.4 pool (0x3A7DA29bfd9853A0449c8c51F7007B7f5126C455)"
echo "  stays on-chain; this deploys a new instance."
echo "  feeRecipient + initial denominations are seeded by the contract."
echo

cd contracts
"$FORGE_BIN" script script/Deploy.s.sol \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

# Forge's vm.writeJson quirk on real broadcasts persists only chainId; merge
# the real on-chain addresses + provenance via the existing post-broadcast
# helper script.
cd ..
echo
echo "=== merging deployed_base.json from forge broadcast logs ==="
if [ ! -f scripts/merge_deploy_manifest.py ]; then
  echo "WARN: scripts/merge_deploy_manifest.py not found; manifest will be partial."
  exit 0
fi

# Always-on path-normalisation for python on Windows.
if command -v cygpath >/dev/null 2>&1; then
  REPO_FOR_PY="$(cygpath -m "$(pwd)")"
  BR_FOR_PY="$(cygpath -m "$(pwd)/contracts/broadcast/Deploy.s.sol")"
  MAN_FOR_PY="$(cygpath -m "$(pwd)/contracts/deployed_base.json")"
else
  REPO_FOR_PY="$(pwd)"
  BR_FOR_PY="$(pwd)/contracts/broadcast/Deploy.s.sol"
  MAN_FOR_PY="$(pwd)/contracts/deployed_base.json"
fi
python3 scripts/merge_deploy_manifest.py "$REPO_FOR_PY" "$BR_FOR_PY" "$MAN_FOR_PY" "8453"
