#!/usr/bin/env bash
# Redeploy ConfidentialNotesVerifier + ConfidentialNotes on Base mainnet.
#
# The on-chain ConfidentialNotesVerifier was generated from an OLD version
# of the notes circuit. The browser's WASM/zkey was recompiled on 2026-07-17
# but the verifier was not redeployed. This mismatch causes createNote() to
# revert with InvalidProof() because verifying keys don't match the proving key.
#
# This script redeploys:
#   1. ConfidentialNotesVerifier (Groth16Verifier) — generated anew from
#      notes_final.zkey (must already be in src/ via snarkjs zkey export)
#   2. ConfidentialNotes — fresh contract with the new verifier. The OLD
#      ConfidentialNotes address (0x84f5...) is superseded.
#
# After the deploy, run scripts/notes_post_deploy.py to update:
#   - backend/server.py  (_NOTES_CONTRACT_ADDR + _NOTES_VERIFIER_ADDR)
#   - frontend/src/lib/confidential-notes.js (NOTES_ADDR constant)
#   - contracts/deployed_base.json (confidential_notes + confidential_notes_verifier)
#
# Required env:
#   BASE_RPC_URL=$https://mainnet.base.org  (or any Base mainnet RPC)
#   DEPLOYER_PRIVATE_KEY=0x...               (funded wallet on Base)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTRACTS_DIR="${REPO_ROOT}/contracts"

log() { printf '[deploy_notes_verifier] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ─── Preflight ───────────────────────────────────────────────────────────────
command -v forge >/dev/null 2>&1 || die "forge not found (install with: foundryup)"
command -v cast  >/dev/null 2>&1 || die "cast not found (install with: foundryup)"

BASE_RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
[ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is not set."

DEPLOYER_ADDR="$(cast wallet address "${DEPLOYER_PRIVATE_KEY}" 2>/dev/null || true)"
[ -n "${DEPLOYER_ADDR}" ] || die "Could not derive deployer address."

BALANCE="$(cast balance "${DEPLOYER_ADDR}" --rpc-url "${BASE_RPC_URL}" 2>/dev/null || true)"
log "Deployer: ${DEPLOYER_ADDR}  Balance: ${BALANCE:-<unreachable>} wei"
[ -n "${BALANCE}" ] && [ "${BALANCE}" != "0" ] || die "Deployer has zero balance. Fund ${DEPLOYER_ADDR} first."

# Verify the new verifier .sol was generated from the current zkey
ZKEY_FILE="${REPO_ROOT}/frontend/public/zk-pool/notes_final.zkey"
VERIFIER_SOL="${CONTRACTS_DIR}/src/ConfidentialNotesVerifier.sol"
[ -f "${ZKEY_FILE}" ] || die "notes_final.zkey not found at ${ZKEY_FILE}"
[ -f "${VERIFIER_SOL}" ] || die "ConfidentialNotesVerifier.sol not found at ${VERIFIER_SOL}"

ZKEY_MTIME="$(stat -c %Y "${ZKEY_FILE}" 2>/dev/null || stat -f %m "${ZKEY_FILE}" 2>/dev/null)"
SOL_MTIME="$(stat -c %Y "${VERIFIER_SOL}" 2>/dev/null || stat -f %m "${VERIFIER_SOL}" 2>/dev/null)"
[ "${SOL_MTIME}" -ge "${ZKEY_MTIME}" ] \
    || die "ConfidentialNotesVerifier.sol is OLDER than notes_final.zkey. Regenerate it:"$'\n'"  npx snarkjs zkey export solidityverifier notes_final.zkey ConfidentialNotesVerifier.sol"

# ─── Build ───────────────────────────────────────────────────────────────────
log "Building contracts..."
( cd "${CONTRACTS_DIR}" && forge build ) || die "forge build failed — fix compile errors."

# ─── Confirmation ────────────────────────────────────────────────────────────
echo "" >&2
echo "============================================================" >&2
echo "  NOTES VERIFIER REDEPLOY — Base mainnet (chainId 8453)" >&2
echo "============================================================" >&2
echo "  Deployer:           ${DEPLOYER_ADDR}" >&2
echo "  RPC:                ${BASE_RPC_URL}" >&2
echo "" >&2
echo "  Contracts to deploy:" >&2
echo "    1. ConfidentialNotesVerifier  (Groth16 — freshly exported from notes_final.zkey)" >&2
echo "    2. ConfidentialNotes          (uses new verifier; deployer = owner)" >&2
echo "" >&2
echo "  The OLD ConfidentialNotes (0x84f5...) will be superseded." >&2
echo "  The Merkle tree state will NOT carry over (fresh start)." >&2
echo "============================================================" >&2
read -r -p "Type 'DEPLOY' to confirm: " CONFIRM
[ "${CONFIRM}" = "DEPLOY" ] || die "Aborted."

# ─── Broadcast ───────────────────────────────────────────────────────────────
log "Broadcasting DeployNotesVerifier.s.sol..."
( cd "${CONTRACTS_DIR}" && forge script script/DeployNotesVerifier.s.sol \
    --rpc-url "${BASE_RPC_URL}" \
    --private-key "${DEPLOYER_PRIVATE_KEY}" \
    --broadcast )

# ─── Parse addresses from broadcast log ──────────────────────────────────────
BROADCAST_JSON="${CONTRACTS_DIR}/broadcast/DeployNotesVerifier.s.sol/8453/run-latest.json"
[ -f "${BROADCAST_JSON}" ] || die "Broadcast JSON not found at ${BROADCAST_JSON}."

NEW_VERIFIER_ADDR="$(grep -A1 '"contractName": "Groth16Verifier"' "${BROADCAST_JSON}" \
    | grep '"contractAddress"' | sed 's/.*: "\(0x[0-9a-fA-F]*\)".*/\1/' | head -1)"
NEW_NOTES_ADDR="$(grep -A1 '"contractName": "ConfidentialNotes"' "${BROADCAST_JSON}" \
    | grep '"contractAddress"' | sed 's/.*: "\(0x[0-9a-fA-F]*\)".*/\1/' | head -1)"

[ -n "${NEW_VERIFIER_ADDR}" ] || die "Could not parse ConfidentialNotesVerifier address from broadcast."
[ -n "${NEW_NOTES_ADDR}" ] || die "Could not parse ConfidentialNotes address from broadcast."

log ""
log "============================================================"
log "  DEPLOY SUCCESS"
log "============================================================"
log "  ConfidentialNotesVerifier: ${NEW_VERIFIER_ADDR}"
log "  ConfidentialNotes:         ${NEW_NOTES_ADDR}"
log "  Owner:                     ${DEPLOYER_ADDR}"
log "============================================================"
log ""

# ─── Auto-update backend/frontend ────────────────────────────────────────────
log "Updating backend server.py + frontend confidential-notes.js..."
python3 "${SCRIPT_DIR}/notes_post_deploy.py" \
    "${NEW_VERIFIER_ADDR}" "${NEW_NOTES_ADDR}" \
    || die "Post-deploy updater failed."

log "All files updated. Push to main when ready:"
log "  git add -A && git commit -m 'fix(P6): redeploy Notes verifier from current zkey'"
log "  git push origin main  # triggers Azure rebuild"
