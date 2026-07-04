#!/usr/bin/env bash
# ============================================================================
#  scripts/zk_stealth_setup.sh — P3.8 PoC circuit compiler + key generator
# ----------------------------------------------------------------------------
#  ⚠ RESEARCH-ONLY — DO NOT DEPLOY TO MAINNET UNTIL AUDIT. ⚠
#
#  Builds the PoC stealth-owner circuit (Poseidon(spend,view,eph.x) = commit)
#  and outputs:
#     contracts/circuits/build/stealth_owner.r1cs
#     contracts/circuits/build/stealth_owner_js/stealth_owner.wasm
#     contracts/circuits/build/stealth_owner_final.zkey
#     contracts/circuits/build/stealth_owner_verification_key.json
#     contracts/src/StealthOwnerVerifier.sol              (snarkjs-generated)
#     contracts/test/StealthOwnerVerifierInputs.sol       (test-input constants)
#
#  Uses the existing pot_final.ptau (Phase 3 PoT ceremony) as the trusted
#  setup — same ceremony as the privacy-pool withdraw circuit. This is fine
#  for a PoC; production deployment must use an MPC-contributed tau.
#
#  Run on WSL where circom + snarkjs exist (Node v20.20.2 / snarkjs 0.7.6).
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
CIRCUITS_DIR="${ROOT}/contracts/circuits"
BUILD_DIR="${CIRCUITS_DIR}/build"
PTAU="${BUILD_DIR}/pot_final.ptau"
SRC="${CIRCUITS_DIR}/stealth_owner.circom"
WASM_NAME="stealth_owner"

log() { printf '[zk_stealth] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

command -v circom >/dev/null 2>&1 || die "circom not on PATH (install in WSL)."
command -v snarkjs >/dev/null 2>&1 || die "snarkjs not on PATH (npm i -g snarkjs)."

[ -f "${SRC}" ] || die "missing ${SRC}"
[ -f "${PTAU}" ] || die "missing ${PTAU} — run scripts/zk_powers_of_tau.sh first"
[ -d "${CIRCUITS_DIR}/circomlib" ] || die "missing circomlib checkout under contracts/circuits"

mkdir -p "${BUILD_DIR}"

# 1. Compile to R1CS + WASM witness generator
log "Compiling circuit → ${BUILD_DIR}/${WASM_NAME}.r1cs + ${WASM_NAME}.wasm"
( cd "${CIRCUITS_DIR}" && circom "${WASM_NAME}.circom" \
    --r1cs --wasm --sym \
    -o "${BUILD_DIR}" -l "$(pwd)/circomlib" )

# Sanity: r1cs info
log "Constraint summary:"
( cd "${BUILD_DIR}" && snarkjs r1cs info "${WASM_NAME}.r1cs" )

# 2. Groth16 setup → producing key
log "Generating ${WASM_NAME}_final.zkey (Groth16 setup)"
( cd "${BUILD_DIR}" && snarkjs groth16 setup \
    "${WASM_NAME}.r1cs" "${PTAU}" "${WASM_NAME}_0000.zkey" )
( cd "${BUILD_DIR}" && snarkjs zkey contribute \
    "${WASM_NAME}_0000.zkey" "${WASM_NAME}_final.zkey" \
    --name="P3.8 PoC contribution" -v -e="$(openssl rand -hex 32)" )

# 3. Verification key + Solidity verifier
log "Exporting verification_key.json + StealthOwnerVerifier.sol"
( cd "${BUILD_DIR}" && snarkjs zkey export verificationkey \
    "${WASM_NAME}_final.zkey" "${WASM_NAME}_verification_key.json" )
( cd "${BUILD_DIR}" && snarkjs zkey export solidityverifier \
    "${WASM_NAME}_final.zkey" "${ROOT}/contracts/src/StealthOwnerVerifier.sol" )

log "✓ PoC artifacts ready under:"
log "    contracts/src/StealthOwnerVerifier.sol (snarkjs-generated Groth16 verifier)"
log "    contracts/circuits/build/stealth_owner.wasm   (witness generator)"
log "    contracts/circuits/build/stealth_owner_final.zkey   (proving key)"
log "    contracts/circuits/build/stealth_owner_verification_key.json"
log ""
log "Reminder: this is a RESEARCH PoC. Do not announce to real users."
log "Real deployment requires (1) external audit of the circuit, (2) MPC tau."
