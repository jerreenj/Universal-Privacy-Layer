#!/usr/bin/env bash
# =============================================================================
# UPL Solana — ONE-SHOT mainnet flip (P2.10 Step 10b)
# -----------------------------------------------------------------------------
# THE "push to mainnet" command. Deploys the SAME program (same keypair → same
# program ID E4yQzfbV…) to Solana MAINNET and writes the mainnet manifest.
# Backend + frontend already read program_id/registry_pda/network from the
# manifest + env vars, so NO code changes are needed — only 3 env-var flips
# (printed at the end) after this script succeeds.
#
# This script is DELIBERATELY GUARDED so it cannot fire by accident:
#   UPL_SOL_FUND_CONFIRMED=1  must be set, AND
#   the deployer wallet must hold ≥ $MIN_MAINNET_SOL SOL (rent + gas).
# Without both, it exits without spending anything.
#
# Prereqs:
#   1. ~5 SOL funded on the deployer wallet (program rent ~1.8 SOL is mostly
#      reclaimable later; the rest is gas).
#   2. The preserved keypair at scripts/.upl_sol-deploy-keypair.json (written
#      by anchor build / deploy_sol_devnet.sh — same keypair → same program ID).
#
# Usage (from WSL):
#   UPL_SOL_FUND_CONFIRMED=1 \
#   SOL_MAINNET_RPC_URL='https://mainnet.helius-rpc.com/?api-key=<KEY>' \
#     bash scripts/flip_sol_to_mainnet.sh
#
# The RPC URL (with key) comes from the env — NEVER hardcode an API key here.
# Falls back to the public mainnet RPC if unset (slower, rate-limited).
# =============================================================================
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

MIN_MAINNET_SOL="${MIN_MAINNET_SOL:-3.0}"
PROGID="E4yQzfbV8dpf1DH33u3ESNm3wvX2UYpQRnb3NVnAtT7x"
RPC="${SOL_MAINNET_RPC_URL:-https://api.mainnet-beta.solana.com}"
WALLET="${SOL_WALLET:-$HOME/.config/solana/id.json}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANCHOR_DIR="$REPO/contracts/solana"
PRESERVED_KP="$REPO/scripts/.upl_sol-deploy-keypair.json"
MANIFEST="$REPO/scripts/deployed_sol_mainnet.json"

B='\033[1;34m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say(){ printf "${B}▶${N} %s\n" "$*"; }
ok(){  printf "${G}✓${N} %s\n" "$*"; }
warn(){ printf "${Y}!${N} %s\n" "$*"; }
die(){ printf "${R}✗${N} %s\n" "$*"; exit 1; }

echo "================================================================"
say "${R}UPL Solana — MAINNET DEPLOY (Step 10b)${N}"
echo "================================================================"

# ── GUARD 1: explicit confirmation ──────────────────────────────────────────
if [ "${UPL_SOL_FUND_CONFIRMED:-0}" != "1" ]; then
  die "Refusing to run: set UPL_SOL_FUND_CONFIRMED=1 to confirm you have funded
     the deployer wallet with ≥ ${MIN_MAINNET_SOL} SOL of REAL mainnet SOL.
     This spends REAL money. Re-run with:
       UPL_SOL_FUND_CONFIRMED=1 bash scripts/flip_sol_to_mainnet.sh"
fi

# ── GUARD 2: balance check ──────────────────────────────────────────────────
command -v solana >/dev/null 2>&1 || die "solana CLI not found."
[ -f "$WALLET" ] || die "wallet not found: $WALLET"
solana config set --url "$RPC" >/dev/null 2>&1
PUB="$(solana-keygen pubkey "$WALLET")"
BAL="$(solana balance --keypair "$WALLET" 2>/dev/null | awk '{print $1}')"
say "deployer: $PUB   balance: ${BAL:-0} SOL   (mainnet)"
if awk "BEGIN{exit !(${BAL:-0} < $MIN_MAINNET_SOL)}"; then
  die "Balance ${BAL:-0} SOL < ${MIN_MAINNET_SOL} SOL minimum. Fund the wallet
     with REAL mainnet SOL and re-run. (Program rent ~1.8 SOL is mostly
     reclaimable; the rest is gas. ~5 SOL is comfortable.)"
fi
ok "balance OK (${BAL} ≥ ${MIN_MAINNET_SOL} SOL)"

# ── GUARD 3: preserved keypair ──────────────────────────────────────────────
[ -f "$PRESERVED_KP" ] || die "Preserved keypair not found: $PRESERVED_KP
     Run scripts/deploy_sol_devnet.sh first (it writes this keypair), so devnet
     + mainnet share program ID $PROGID."
KP_PUB="$(solana-keygen pubkey "$PRESERVED_KP")"
[ "$KP_PUB" = "$PROGID" ] || die "Keypair pubkey ($KP_PUB) != expected program ID ($PROGID)."
ok "keypair OK (program ID $PROGID — same as devnet)"

# ── BUILD (with preserved keypair) ──────────────────────────────────────────
cd "$ANCHOR_DIR"
say "anchor build (restoring preserved keypair first)…"
mkdir -p target/deploy
cp "$PRESERVED_KP" target/deploy/upl_sol-keypair.json
anchor build -- --tools-version v1.53
SO="target/deploy/upl_sol.so"
[ -f "$SO" ] || die "build finished but $SO not found."
ok "built $SO ($(du -h "$SO" | cut -f1))"

# ── DEPLOY TO MAINNET ───────────────────────────────────────────────────────
say "${R}DEPLOYING TO MAINNET (real gas)…${N}"
if solana program show "$PROGID" --url "$RPC" >/dev/null 2>&1; then
  warn "Program $PROGID already on mainnet — running upgrade instead."
  DEPLOY_OUT="$(solana program deploy "$SO" --program-id "$PRESERVED_KP" --url "$RPC" 2>&1 | tee /dev/stderr)"
else
  DEPLOY_OUT="$(solana program deploy "$SO" --program-id "$PRESERVED_KP" --url "$RPC" 2>&1 | tee /dev/stderr)"
fi
DEPLOY_TX="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE '[1-9A-HJ-NP-Za-km-z]{64,88}' | head -1 || true)"
ok "deployed. program=$PROGID  tx=${DEPLOY_TX:-<see output above>}"

# ── DERIVE REGISTRY PDA + WRITE MANIFEST ────────────────────────────────────
say "deriving Registry PDA…"
REGISTRY_PDA="$(python3 - <<PY 2>/dev/null || true
from solders.pubkey import Pubkey
p, _ = Pubkey.find_program_address([b"registry"], Pubkey.from_string("$PROGID"))
print(str(p))
PY
)"
[ -n "$REGISTRY_PDA" ] || REGISTRY_PDA="$(solana find-program-derived-address "$PROGID" registry 2>/dev/null | awk '{print $1}' || true)"
ok "registry PDA: ${REGISTRY_PDA:-<unknown>}"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SOL_CLI_VER="$(solana --version)"
python3 - "$MANIFEST" "$PROGID" "$REGISTRY_PDA" "$PUB" "$NOW" "$SOL_CLI_VER" "$DEPLOY_TX" <<'PY'
import json, sys
path, prog, reg, pub, now, ver, tx = sys.argv[1:8]
try: data = json.load(open(path))
except Exception: data = {}
data.update({
    "network": "mainnet", "sol_cli_version": ver, "published_at": now,
    "program_id": prog, "registry_pda": reg or None, "publisher_address": pub,
    "deploy_tx": tx or None,
})
data.setdefault("announcements_count", 0)
data.setdefault("total_relayed", 0)
data.setdefault("test_relay_tx", None)
json.dump(data, open(path, "w"), indent=2)
print("  wrote:", path)
PY
ok "manifest written."

# Re-preserve keypair in case the build regenerated it.
cp target/deploy/upl_sol-keypair.json "$PRESERVED_KP"

echo
say "${G}MAINNET DEPLOY COMPLETE${N}"
echo "  program : $PROGID"
echo "  registry: ${REGISTRY_PDA:-<n/a>}"
echo "  explorer: https://solscan.io/account/$PROGID"
echo
say "${Y}NOW FLIP THESE 3 ENV VARS + REDEPLOY BACKEND/FRONTEND:${N}"
echo "  backend : SOL_DEFAULT_NETWORK=mainnet"
echo "            UPL_DEPLOYED_SOL_JSON=$(cd "$REPO" && pwd)/scripts/deployed_sol_mainnet.json"
echo "  frontend: REACT_APP_SOL_RPC_URL=$RPC"
echo "            REACT_APP_SOL_DEVNET=false"
echo
echo "  The UI 'devnet / test mode' badge auto-hides once REACT_APP_SOL_DEVNET=false."
echo "  Base + Sui are untouched (already mainnet)."
