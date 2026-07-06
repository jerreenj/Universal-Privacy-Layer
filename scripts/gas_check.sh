#!/bin/bash
# scripts/gas_check.sh
# Compute Base mainnet gas + estimated deploy cost for the multi-denom
# PrivacyPool redeploy. Reads DEPLOYER_PRIVATE_KEY from contracts/.env to
# derive the address; never logs the key.
set -e

cd "$(dirname "$0")/.."

# Total gas the redeploy script will burn. Past P3.4 single-contract
# broadcast on Base typically lands around 700-900k gas (5 contracts,
# PoseidonT3 library linking). For a multi-denom pool READ+WRITE we'll
# budget a generous 1.5M gas units and let the actual broadcast report
# the precise usage at the end of the dry-run.
BUDGET_GAS=1500000

PRIV=$(grep '^DEPLOYER_PRIVATE_KEY=' contracts/.env | cut -d= -f2-)
[ -z "$PRIV" ] && { echo "no DEPLOYER_PRIVATE_KEY in contracts/.env"; exit 1; }

CAST=/mnt/c/Users/AGBS\ Studio/.foundry/bin/cast.exe

ADDR=$("$CAST" wallet address --private-key "$PRIV" 2>/dev/null)
BAL_WEI=$("$CAST" balance "$ADDR" --rpc-url https://mainnet.base.org 2>/dev/null)
GP_WEI=$("$CAST" gas-price --rpc-url https://mainnet.base.org 2>/dev/null)

# Estimated cost for the broadcast at the budgeted gas usage.
COST_WEI=$(python3 -c "print($BUDGET_GAS * $GP_WEI)")
# 20% safety buffer.
COST_WEI_BUFFER=$(python3 -c "print(int($COST_WEI * 1.2))")

python3 - <<PY
bal = $BAL_WEI
gp = $GP_WEI
cost = $COST_WEI
buf = $COST_WEI_BUFFER
print(f"deployer: {('$ADDR')}")
print(f"balance: {bal / 1e18:.6f} ETH ({(bal)} wei)")
print(f"gas-price: {gp / 1e9:.4f} gwei  ({gp} wei)")
print(f"budget: {('$BUDGET_GAS')} gas units")
print(f"est. cost @ budget: {cost / 1e18:.6f} ETH")
print(f"est. cost + 20 pct safety: {buf / 1e18:.6f} ETH")
print(f"balance after broadcast (worst case): {(bal - buf) / 1e18:.6f} ETH")
print(f"surplus remaining: {'YES' if (bal - buf) > 0 else 'NO -- top up'}")
PY
