#!/usr/bin/env bash
# =============================================================================
# UPL Solana — DEVNET faucet drip (P2.10 Step C.3 → 10a)
# -----------------------------------------------------------------------------
# Idempotent helper that tops up the deployer wallet with free devnet SOL,
# tolerating the Helius faucet's 1-SOL-per-project-per-day rate limit.
#
# Program rent for the ~254 KB upl_sol binary is ~1.8 SOL, so this needs to run
# ~2 days in a row (or you fund the wallet directly). Run once a day; each
# successful call adds ~1-2 SOL until the target is reached. Once the balance
# is ≥ $TARGET_SOL, run scripts/deploy_sol_devnet.sh to deploy.
#
# Usage (from WSL):
#   SOL_DEVNET_RPC_URL='https://devnet.helius-rpc.com/?api-key=<KEY>' \
#     bash scripts/sol_devnet_drip.sh
#
# The RPC URL (with key) comes from the env — NEVER hardcode an API key here.
# Falls back to the public devnet RPC (https://api.devnet.solana.com) if unset.
# =============================================================================
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

TARGET_SOL="${TARGET_SOL:-2.5}"   # safe margin over the ~1.8 SOL rent
RPC="${SOL_DEVNET_RPC_URL:-https://api.devnet.solana.com}"
WALLET="${SOL_WALLET:-$HOME/.config/solana/id.json}"

B='\033[1;34m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say(){ printf "${B}▶${N} %s\n" "$*"; }
ok(){  printf "${G}✓${N} %s\n" "$*"; }
warn(){ printf "${Y}!${N} %s\n" "$*"; }

command -v solana >/dev/null 2>&1 || { printf "${R}✗${N} solana CLI not found.\n"; exit 1; }
[ -f "$WALLET" ] || { printf "${R}✗${N} wallet not found: $WALLET\n"; exit 1; }

solana config set --url "$RPC" >/dev/null 2>&1
PUB="$(solana-keygen pubkey "$WALLET")"
say "devnet drip — wallet $PUB  (target ${TARGET_SOL} SOL)"
echo "  rpc: $RPC"

get_bal() { solana balance --keypair "$WALLET" 2>/dev/null | awk '{print $1}'; }
BAL="$(get_bal)"
ok "current balance: ${BAL:-0} SOL"

# Already funded?
if awk "BEGIN{exit !(${BAL:-0} >= $TARGET_SOL)}"; then
  ok "Already at target (${BAL} ≥ ${TARGET_SOL} SOL). Ready to deploy:"
  echo "    bash scripts/deploy_sol_devnet.sh"
  exit 0
fi

# Try up to 3 airdrops of 2 SOL each. The faucet rate-limits hard, so most will
# fail — that's expected. Each success is real progress.
SUCCESS=0
for attempt in 1 2 3; do
  say "airdrop attempt $attempt (2 SOL)…"
  if solana airdrop 2 --keypair "$WALLET" >/dev/null 2>&1; then
    ok "  +2 SOL"
    SUCCESS=$((SUCCESS + 1))
  else
    warn "  rate-limited or failed (ok — retry tomorrow)."
  fi
  sleep 3
done

BAL="$(get_bal)"
echo
ok "balance now: ${BAL:-0} SOL  (+${SUCCESS} airdrops this run)"
if awk "BEGIN{exit !(${BAL:-0} >= $TARGET_SOL)}"; then
  ok "${G}TARGET REACHED${N} — ready to deploy:  bash scripts/deploy_sol_devnet.sh"
else
  REMAINING="$(awk "BEGIN{printf \"%.2f\", $TARGET_SOL - ${BAL:-0}}")"
  warn "Still need ~${REMAINING} SOL. Re-run this script in ~24h (faucet cap is"
  warn "1 SOL/day per project), or fund the wallet directly, then deploy."
fi
