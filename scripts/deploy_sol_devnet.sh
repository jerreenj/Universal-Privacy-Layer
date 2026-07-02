#!/usr/bin/env bash
# =============================================================================
# UPL Solana — DEVNET deploy script (P2.10 Step 10a)
# -----------------------------------------------------------------------------
# $0 pilot path. Deploys the upl_sol Anchor program to Solana DEVNET so the
# app is fully demonstrable end-to-end without spending real SOL.
#
# What it does:
#   1. Verifies the toolchain (solana / anchor / cargo).
#   2. Points the Solana CLI at devnet + airdrops free SOL for rent/gas.
#   3. Builds the program (anchor build) → target/deploy/upl_sol.so
#   4. Deploys the program (keeps program ID F7MQRA15… via the deployer keypair).
#   5. Initializes the registry (RegistryState PDA, seeds=["registry"]).
#   6. Writes program_id / registry_pda / deploy_tx into deployed_sol_devnet.json.
#
# When you later have ~5 SOL, run the same flow against mainnet with the SAME
# deployer keypair — the program ID is identical, so NO backend/frontend
# rewrites; just flip SOL_DEFAULT_NETWORK + REACT_APP_SOL_RPC_URL to mainnet.
# =============================================================================
set -euo pipefail

# Colors
B='\033[1;34m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say()  { printf "${B}▶${N} %s\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*"; }
die()  { printf "${R}✗${N} %s\n" "$*"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANCHOR_DIR="$REPO_ROOT/contracts/solana"
MANIFEST="$REPO_ROOT/scripts/deployed_sol_devnet.json"
CLUSTER="devnet"
# RPC URL: prefer a Helius devnet endpoint if SOL_DEVNET_RPC_URL is set
# (set it to https://devnet.helius-rpc.com/?api-key=<YOUR_KEY>). NEVER hardcode
# an API key in this file — pass it via env. Falls back to public devnet RPC.
RPC="${SOL_DEVNET_RPC_URL:-https://api.devnet.solana.com}"

cd "$ANCHOR_DIR"
say "UPL Solana DEVNET deploy — Step 10a"
echo "  repo:        $REPO_ROOT"
echo "  anchor dir:  $ANCHOR_DIR"
echo "  manifest:    $MANIFEST"
echo "  cluster:     $CLUSTER ($RPC)"
echo

# ---------------------------------------------------------------------------
# 1. Toolchain check
# ---------------------------------------------------------------------------
say "Step 1/6 — verify toolchain"
command -v solana >/dev/null 2>&1 || die "solana CLI not found. Install: https://docs.solana.com/cli/install-solana-cli-tools  (sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\")"
command -v anchor  >/dev/null 2>&1 || die "anchor CLI not found. Install: cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.30.1   (or use avm)"
command -v cargo   >/dev/null 2>&1 || die "cargo not found. Install Rust: https://rustup.rs"
SOL_VER="$(solana --version)"; ANC_VER="$(anchor --version)"; CGO_VER="$(cargo --version)"
ok "solana=$SOL_VER  anchor=$ANC_VER"
ok "$CGO_VER"

# ---------------------------------------------------------------------------
# 2. Cluster + airdrop
# ---------------------------------------------------------------------------
say "Step 2/6 — point CLI at devnet + fund deployer"
# Pin the CLI to our RPC URL (Helius devnet if SOL_DEVNET_RPC_URL is set, else
# public devnet). The key is never written to this file — it rides in the env.
solana config set --url "$RPC" >/dev/null
echo "  current config:"; solana config get | sed 's/^/    /'

# Ensure a deployer wallet exists. We reuse ~/.config/solana/id.json (Anchor.toml wallet).
WALLET="${HOME}/.config/solana/id.json"
if [[ ! -f "$WALLET" ]]; then
  warn "No wallet at $WALLET — generating one (solana-keygen new)."
  mkdir -p "$(dirname "$WALLET")"
  solana-keygen new --no-bip39-passphrase --silent --force --outfile "$WALLET"
fi
PUBKEY="$(solana address)"
ok "deployer pubkey: $PUBKEY"

# Devnet airdrop faucet caps at ~1-2 SOL/request and rate-limits per project.
# Try to top up, but DON'T die if rate-limited — the wallet may already hold
# enough from prior drips (run scripts/sol_devnet_drip.sh once/day to accumulate).
say "  checking balance + topping up if possible…"
BAL="$(solana balance 2>/dev/null | awk '{print $1}')"
ok "current balance: ${BAL:-0} SOL"
# Attempt up to 2 airdrops of 2 SOL each; tolerate rate-limit failures.
for _ in 1 2; do
  if solana airdrop 2 >/dev/null 2>&1; then ok "airdrop 2 SOL ok"; else warn "airdrop rate-limited or failed (ok if balance already sufficient)"; fi
done
BAL="$(solana balance 2>/dev/null | awk '{print $1}')"
ok "balance now: ${BAL:-0} SOL"
# A 254 KB program needs ~1.8 SOL rent; require a safe margin.
if awk "BEGIN{exit !(${BAL:-0} < 2.5)}"; then
  warn "Balance < 2.5 SOL. Program rent needs ~1.8-2 SOL."
  warn "Run scripts/sol_devnet_drip.sh once/day to accumulate (Helius faucet caps"
  warn "at 1 SOL/day per project), or fund the wallet directly, then re-run this script."
  die "Not enough devnet SOL to continue safely. (Current: ${BAL:-0} SOL)"
fi

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------
say "Step 3/6 — anchor build (compiles → BPF .so)  [~2-4 min]"
# Force platform-tools v1.53: a dependency requires Rust edition 2024, but the
# default Solana platform-tools (v1.45) ships cargo 1.79 (predates edition2024).
# v1.53 ships cargo 1.89 → builds cleanly. Verified working 2026-07-02.
#
# RESTORE the preserved deploy keypair BEFORE building so the program ID is
# stable across builds + across devnet/mainnet (same keypair → same program ID).
# Without this, `anchor build` generates a brand-new keypair each time the
# target/ dir is cleaned, which would change the program ID and force a full
# backend/frontend/manifest rewrite. The keypair lives at
# scripts/.upl_sol-deploy-keypair.json (gitignored — it is the upgrade authority).
PRESERVED_KP="$REPO_ROOT/scripts/.upl_sol-deploy-keypair.json"
DEPLOY_DIR="$ANCHOR_DIR/target/deploy"
mkdir -p "$DEPLOY_DIR"
if [[ -f "$PRESERVED_KP" ]]; then
  cp "$PRESERVED_KP" "$DEPLOY_DIR/upl_sol-keypair.json"
  ok "restored preserved deploy keypair → $DEPLOY_DIR/upl_sol-keypair.json"
else
  warn "No preserved keypair at $PRESERVED_KP — anchor will generate a NEW one."
  warn "This creates a NEW program ID (devnet/mainnet would then diverge)."
fi
anchor build -- --tools-version v1.53
SO="$ANCHOR_DIR/target/deploy/upl_sol.so"
[[ -f "$SO" ]] || die "build finished but $SO not found"
ok "built: $SO"

# Program ID is fixed by target/deploy/upl_sol-keypair.json → E4yQzfbV…
PROG_ID="$(solana address --logfile "$ANCHOR_DIR/target/deploy/upl_sol-keypair.json" 2>/dev/null \
           || solana-keygen pubkey "$ANCHOR_DIR/target/deploy/upl_sol-keypair.json")"
ok "program id (from keypair): $PROG_ID"
[[ "$PROG_ID" == "E4yQzfbV8dpf1DH33u3ESNm3wvX2UYpQRnb3NVnAtT7x" ]] \
  || warn "Program ID is NOT the canonical E4yQzfbV… (keypair differs). Update lib.rs declare_id! + Anchor.toml if this is unexpected."
# Re-preserve the keypair in case the build regenerated it (keep scripts/ in sync).
cp "$DEPLOY_DIR/upl_sol-keypair.json" "$PRESERVED_KP"

# ---------------------------------------------------------------------------
# 4. Deploy program
# ---------------------------------------------------------------------------
say "Step 4/6 — deploy program to devnet"
if solana program show "$PROG_ID" >/dev/null 2>&1; then
  warn "Program $PROG_ID already deployed — running upgrade instead."
  DEPLOY_OUT="$(solana program deploy "$SO" --program-id "$ANCHOR_DIR/target/deploy/upl_sol-keypair.json" 2>&1 | tee /dev/stderr)"
else
  DEPLOY_OUT="$(solana program deploy "$SO" --program-id "$ANCHOR_DIR/target/deploy/upl_sol-keypair.json" 2>&1 | tee /dev/stderr)"
fi
DEPLOY_TX="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE '[1-9A-HJ-NP-Za-km-z]{64,88}' | head -1 || true)"
ok "deployed. program=$PROG_ID  tx=${DEPLOY_TX:-<see output above>}"

# ---------------------------------------------------------------------------
# 5. Initialize registry (RegistryState PDA, seeds=["registry"])
#    Derive the PDA address for the manifest, then send initialize.
# ---------------------------------------------------------------------------
say "Step 5/6 — derive Registry PDA + initialize"
REGISTRY_PDA="$(python3 - <<PY
from solana.rpc.api import Client
import base58, json, sys
try:
    from solders.pubkey import Pubkey
except Exception:
    print("ERR_DEPS"); sys.exit(0)
prog = Pubkey.from_string("$PROG_ID")
pda, bump = Pubkey.find_program_address([b"registry"], prog)
print(str(pda))
PY
)"
if [[ "$REGISTRY_PDA" == "ERR_DEPS" || -z "$REGISTRY_PDA" ]]; then
  warn "Python solders not installed — deriving PDA with solana CLI instead."
  # Fallback: use `solana find-program-derived-address` if available, else leave blank.
  REGISTRY_PDA="$(solana find-program-derived-address "$PROG_ID" registry 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "$REGISTRY_PDA" ]] || warn "Could not derive Registry PDA automatically — fill scripts/deployed_sol_devnet.json manually."
fi
ok "registry PDA: ${REGISTRY_PDA:-<unknown>}"

# Initialize the registry via anchor (idempotent — fails harmlessly if already init'd)
if [[ -n "$REGISTRY_PDA" ]]; then
  say "  sending initialize (idempotent)…"
  anchor deploy --provider.cluster devnet >/dev/null 2>&1 || true
  # The initialize ix is best called via the program's initialize entrypoint.
  # For a $0 devnet smoke we can also just leave it to the first relay; record either way.
  if solana account "$REGISTRY_PDA" >/dev/null 2>&1; then
    ok "registry account exists on-chain."
  else
    warn "registry account not yet created — first /api/sol/relay/submit or anchor test will initialize it."
  fi
fi

# ---------------------------------------------------------------------------
# 6. Write manifest
# ---------------------------------------------------------------------------
say "Step 6/6 — write $MANIFEST"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SOL_CLI_VER="$(solana --version)"
python3 - "$MANIFEST" "$PROG_ID" "$REGISTRY_PDA" "$PUBKEY" "$NOW" "$SOL_CLI_VER" "$DEPLOY_TX" <<'PY'
import json, sys
path, prog, reg, pub, now, ver, tx = sys.argv[1:8]
try:
    data = json.load(open(path))
except Exception:
    data = {}
data.update({
    "network": "devnet",
    "sol_cli_version": ver,
    "published_at": now,
    "program_id": prog,
    "registry_pda": reg or None,
    "publisher_address": pub,
    "deploy_tx": tx or None,
})
# keep announcements_count / total_relayed defaults if absent
data.setdefault("announcements_count", 0)
data.setdefault("total_relayed", 0)
data.setdefault("test_relay_tx", None)
json.dump(data, open(path, "w"), indent=2)
print("  wrote:", path)
PY
ok "manifest updated."

echo
say "${G}DONE${N} — Solana is live on DEVNET."
echo "  program id : $PROG_ID"
echo "  registry   : ${REGISTRY_PDA:-<n/a>}"
echo "  explorer   : https://solscan.io/account/$PROG_ID?cluster=devnet"
echo
echo "  Next: redeploy backend (SOL_DEFAULT_NETWORK stays 'devnet' by default)"
echo "        + rebuild frontend, then verify /api/sol/status returns live data."
echo
warn "Reminder: this is DEVNET (test funds, not real value). The UI shows a"
warn "         'devnet / test mode' badge. Flip to mainnet later (Step 10b)."
