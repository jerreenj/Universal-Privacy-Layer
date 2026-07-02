#!/usr/bin/env bash
# =============================================================================
# UPL Solana — LOCAL validator test runner (P2.10 Step C.3-local)
# -----------------------------------------------------------------------------
# Runs the full program test suite against an in-process solana-test-validator.
# $0 — no real network, no SOL, no waiting. Proves the program end-to-end:
#   initialize, relay_and_announce atomicity, recipient balance delta, PDA
#   creation, auth + zero-amount reverts.
#
# MUST run on the native Linux filesystem (~/) — the test-validator's RocksDB
# stalls indefinitely on the Windows-mounted /mnt/c filesystem. This script
# copies the built .so + keypair to ~/upl-sol-test and runs everything there.
#
# Usage (from WSL):
#   bash scripts/sol_local_test.sh
#
# Note on WSL: the validator reliably boots and commits transactions (confirmed
# via validator.log). In some WSL configs the HTTP tx-confirmation polling is
# flaky — if a test hangs on "not confirmed", re-run; on a real Linux box / CI
# runner (see .github/workflows/solana-build-test.yml) it runs clean.
# =============================================================================
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

PROGID="E4yQzfbV8dpf1DH33u3ESNm3wvX2UYpQRnb3NVnAtT7x"
WORK="$HOME/upl-sol-test"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANCHOR_DIR="$REPO/contracts/solana"

# Colors
B='\033[1;34m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say(){ printf "${B}▶${N} %s\n" "$*"; }
ok(){  printf "${G}✓${N} %s\n" "$*"; }
die(){ printf "${R}✗${N} %s\n" "$*"; exit 1; }

command -v solana >/dev/null 2>&1 || die "solana CLI not found."
command -v node   >/dev/null 2>&1 || die "node not found (run: npm install in contracts/solana)."
[ -f "$ANCHOR_DIR/target/deploy/upl_sol.so" ] || die "No built .so — run 'anchor build -- --tools-version v1.53' first."
[ -d "$ANCHOR_DIR/node_modules" ] || die "No node_modules — run 'npm install' in contracts/solana first."

# Copy artifacts to native fs
mkdir -p "$WORK"
cp -f "$ANCHOR_DIR/target/deploy/upl_sol.so"          "$WORK/upl_sol.so"
cp -f "$ANCHOR_DIR/target/deploy/upl_sol-keypair.json" "$WORK/upl_sol-keypair.json"

# The test wallet == genesis mint (auto-funded ~500 SOL at genesis).
WALLET="$HOME/.config/solana/id.json"
[ -f "$WALLET" ] || solana-keygen new --no-bip39-passphrase --silent --force --outfile "$WALLET"
MINT="$(solana-keygen pubkey "$WALLET")"

# Restart validator cleanly on native fs. --mint pins genesis to our wallet so
# anchor.Wallet.local() (ANCHOR_WALLET=id.json) holds the genesis SOL.
pkill -f solana-test-validator 2>/dev/null || true
sleep 2
cd "$WORK"
rm -rf test-ledger validator.log
say "starting local test-validator (mint=$MINT)…"
setsid solana-test-validator --reset \
  --mint "$MINT" \
  --bpf-program "$PROGID" "$WORK/upl_sol.so" \
  --rpc-port 8899 > "$WORK/validator.log" 2>&1 < /dev/null &
VALIDATOR_PID=$!

# Wait for RPC
UP=""
for i in $(seq 1 30); do
  sleep 2
  CV="$(solana cluster-version --url http://127.0.0.1:8899 2>/dev/null || true)"
  [ -n "$CV" ] && { UP="$CV"; break; }
done
[ -n "$UP" ] || { echo "VALIDATOR DID NOT START"; tail -20 "$WORK/validator.log"; exit 1; }
ok "validator UP ($UP)"

# Wait for RPC to serve blockhashes (cluster-version can respond before
# getLatestBlockhash is reliable).
for i in $(seq 1 20); do
  BH="$(curl -s -X POST http://127.0.0.1:8899 -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash"}' 2>/dev/null | grep -o '"blockhash"' || true)"
  [ -n "$BH" ] && break
  sleep 2
done

ok "program loaded: $PROGID"
say "running test suite (ts-mocha)…"
cd "$ANCHOR_DIR"
export ANCHOR_WALLET="$WALLET"
solana config set --url http://127.0.0.1:8899 --keypair "$WALLET" >/dev/null 2>&1
./node_modules/.bin/ts-mocha -t 1000000 tests/**/*.ts
RC=$?

# Cleanup
kill "$VALIDATOR_PID" 2>/dev/null || true
pkill -f solana-test-validator 2>/dev/null || true

echo
if [ "$RC" -eq 0 ]; then ok "ALL TESTS PASSED"; else die "TEST SUITE FAILED (exit $RC). If the failure is 'not confirmed', it is the WSL confirmation-polling limitation — re-run, or run in CI."; fi
exit $RC
