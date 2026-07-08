#!/usr/bin/env bash
# sync_zk_artifacts.sh
#
# Copies the Groth16 ZK circuit artifacts (zkey + wasm) from the
# circom/snarkjs build output to the backend's configured zk_artifacts
# path so the server-side prover can find them at runtime.
#
# Run this AFTER `forge build` (which doesn't produce these — they come
# from circom + snarkjs) and BEFORE starting the backend server.
#
# The artifacts are ~7MB total (5.2MB zkey + 2.0MB wasm) so we don't
# commit them to git — this script reproduces them from the circuits
# build directory.
#
# Usage:
#   bash scripts/sync_zk_artifacts.sh
#
# Or in the Azure CI pipeline, add this as a step after checkout +
# circom install:
#   - name: Sync ZK artifacts
#     run: bash scripts/sync_zk_artifacts.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

SRC_DIR="$REPO_ROOT/contracts/circuits/build"
DST_DIR="$REPO_ROOT/backend/zk_artifacts"

ZKEY="$SRC_DIR/withdraw_final.zkey"
WASM="$SRC_DIR/withdraw_js/withdraw.wasm"

if [ ! -f "$ZKEY" ]; then
  echo "ERROR: $ZKEY not found."
  echo "       Run circom + snarkjs to build the circuit first:"
  echo "         cd contracts/circuits"
  echo "         circom withdraw.circom --r1cs --wasm --sym"
  echo "         npx snarkjs groth16 setup withdraw.r1cs powersOfTau28_hez_final_20.ptau withdraw_0000.zkey"
  echo "         npx snarkjs zkey contribute withdraw_0000.zkey withdraw_final.zkey --name='UPL' -v"
  exit 1
fi

if [ ! -f "$WASM" ]; then
  echo "ERROR: $WASM not found."
  echo "       Run circom to build the wasm:"
  echo "         cd contracts/circuits"
  echo "         circom withdraw.circom --r1cs --wasm --sym"
  exit 1
fi

mkdir -p "$DST_DIR/withdraw_js"
cp "$ZKEY" "$DST_DIR/withdraw_final.zkey"
cp "$WASM" "$DST_DIR/withdraw_js/withdraw.wasm"

echo "ZK artifacts synced to $DST_DIR:"
echo "  zkey: $(ls -la "$DST_DIR/withdraw_final.zkey" | awk '{print $5}') bytes"
echo "  wasm: $(ls -la "$DST_DIR/withdraw_js/withdraw.wasm" | awk '{print $5}') bytes"
echo "Backend prover can now find them at the configured paths."
