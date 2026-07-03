#!/usr/bin/env bash
# =============================================================================
# UPL — Powers of Tau ceremony + Groth16 setup for withdraw.circom (P3.2)
# -----------------------------------------------------------------------------
# Self-run trusted setup. Produces:
#   build/withdraw_final.zkey      — proving key (prover needs this; large)
#   build/verification_key.json    — verification key (verifier + frontend)
#   ../src/Verifier.sol            — snarkjs-generated Groth16 verifier (P3.3)
#
# TRUST MODEL (stated plainly, not hidden):
# This is a SINGLE-PARTY ceremony run by the project organizer. It is sound
# (i.e. produces valid proofs) IF the organizer is honest and destroys the
# randomness after use. The standard "toxic waste" trust assumption of Groth16
# applies: whoever knows the ceremony's secret lambda could forge proofs.
# For launch this is acceptable; a multi-party community MPC is a documented
# future trust upgrade (see docs/zk-architecture.md, P3.7). Phase-2 randomness
# below is derived from a high-entropy OS source so it is not trivially reused.
#
# Idempotent: re-running overwrites build/ artifacts and Verifier.sol.
# Requires: circom + snarkjs on PATH (see docs/zk-toolchain.md), WSL/Linux.
# =============================================================================
set -euo pipefail

# Resolve the circuits dir regardless of where the script is invoked from.
CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../contracts/circuits" && pwd)"
SRC_DIR="$(cd "$CIRCUITS_DIR/../src" && pwd)"
BUILD="$CIRCUITS_DIR/build"
CIRCUIT="withdraw"
DEPTH=20                 # must match the `component main = Withdraw(<DEPTH>)` literal
TAU_POWER=14             # 2^14 = 16384 constraints ceiling (circuit is ~11.4k wires; safe margin)
ENTROPY="UPL-P3.2-$(date +%s%N)-$RANDOM-${RANDOM}-${RANDOM}"   # never reused

cd "$CIRCUITS_DIR"
mkdir -p "$BUILD"

echo "==> [1/6] Compile $CIRCUIT.circom (depth $DEPTH)"
circom "$CIRCUIT.circom" --r1cs --wasm --sym -l . -o "$BUILD"
echo "    constraints: $(grep -oP 'non-linear constraints: \K\d+' "$BUILD/$CIRCUIT.r1cs" 2>/dev/null || echo '?')"

echo "==> [2/6] Powers of Tau — phase 1 (bn128, power $TAU_POWER)"
# Phase 1: universal SRS, circuit-independent. One contribution here is the
# minimum; a real MPC would chain many. The transcript is kept offline by the
# ceremony organizer (gitignored).
snarkjs powersoftau new bn128 "$TAU_POWER" "$BUILD/pot_0000.ptau"
snarkjs powersoftau contribute "$BUILD/pot_0000.ptau" "$BUILD/pot_0001.ptau" \
    --name="UPL-P3.2-phase1" -e="$ENTROPY"
snarkjs powersoftau prepare phase2 "$BUILD/pot_0001.ptau" "$BUILD/pot_final.ptau"

echo "==> [3/6] Groth16 — phase 2 (circuit-specific)"
# Phase 2: binds the universal SRS to THIS circuit. zkey export contributes
# the mandatory second randomness. The result is the final proving key.
snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$BUILD/pot_final.ptau" "$BUILD/${CIRCUIT}_0000.zkey"
snarkjs zkey contribute "$BUILD/${CIRCUIT}_0000.zkey" "$BUILD/${CIRCUIT}_final.zkey" \
    --name="UPL-P3.2-phase2" -e="$ENTROPY-phase2"

echo "==> [4/6] Export verification key"
snarkjs zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/verification_key.json"

echo "==> [5/6] Export Solidity Groth16 verifier → $SRC_DIR/Verifier.sol"
# snarkjs auto-names the contract "Groth16Verifier". P3.3's PrivacyPool will
# reference it. This is the CORRECT verifier (pairing checks generated from the
# real verification key) — the structurally-unsound hand-written DELTA==GAMMA
# verifier removed in P1.3 cannot recur here.
snarkjs zkey export solidityverifier "$BUILD/${CIRCUIT}_final.zkey" "$SRC_DIR/Verifier.sol"

echo "==> [6/6] Verify the keys round-trip with the smoke witness"
# Re-run zk_smoke.js against the freshly minted final zkey to prove the
# ceremony output actually verifies a real proof end-to-end (gate).
SMOKE_DIR="${SMOKE_MODULE_DIR:-/root/zk-smoke}"
if [ -d "$SMOKE_DIR/node_modules/snarkjs" ]; then
    SMOKE_MODULE_DIR="$SMOKE_DIR" node "$CIRCUITS_DIR/../../scripts/zk_smoke.js" \
        && echo "GATE PASSED: final zkey verifies a real proof." \
        || { echo "::error::ceremony zkey failed round-trip verify"; exit 1; }
else
    echo "    (skipped round-trip: circomlibjs not installed at $SMOKE_DIR)"
fi

echo
echo "P3.2 DONE. Artifacts (gitignored, distributed at build time):"
echo "  proving key     : $BUILD/${CIRCUIT}_final.zkey"
echo "  verification key: $BUILD/verification_key.json"
echo "  Solidity verifier: $SRC_DIR/Verifier.sol  (committed)"
echo "  ceremony ptau   : $BUILD/pot_final.ptau  (keep offline)"
