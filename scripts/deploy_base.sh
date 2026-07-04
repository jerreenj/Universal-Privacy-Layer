#!/usr/bin/env bash
# Deploy the UPL EVM contracts (contracts/src) to Base mainnet and emit a
# `contracts/deployed_base.json` manifest the backend reads automatically.
#
# P1.6 deployed the first three contracts (registry, relayer, wrapper). P3.4
# extends this to also deploy the ZK privacy-pool stack: Groth16Verifier +
# PrivacyPool. All five contracts deploy in a single broadcast.
#
# This is the no-gas code so your funded deploy is one command. The script:
#   1. Sanity-checks the environment: `forge` + `cast` on PATH, required env
#      vars set (BASE_RPC_URL, DEPLOYER_PRIVATE_KEY, FEE_RECIPIENT), and a
#      non-zero funded deployer balance (refuses to proceed on empty gas).
#   2. Fails fast on a compile regression via `forge build` before any
#      on-chain work.
#   3. Prints a deploy summary and requires interactive confirmation —
#      feeRecipient AND pool denomination are IMMUTABLE after deploy (no
#      setters), so a wrong value means a costly redeploy.
#   4. Broadcasts the Deploy.s.sol script which deploys all 5 contracts and
#      writes contracts/deployed_base.json (addresses + chainId).
#   5. Enriches the manifest with provenance (deployedAt UTC ISO-8601 + git
#      commit sha) via an inline python step.
#   6. Optionally verifies the contracts on Basescan if BASESCAN_API_KEY is set.
#
# Re-running: each run deploys NEW contract instances (contracts are not
# upgradeable). The manifest is overwritten — back it up before a redeploy if
# you need the prior addresses for indexing/replay.
#
# Required env (see contracts/.env.example):
#   BASE_RPC_URL         — Base mainnet RPC endpoint
#   DEPLOYER_PRIVATE_KEY — funded deployer wallet (becomes owner + relayer)
#   FEE_RECIPIENT        — immutable fee wallet for UniswapPrivacyWrapper
#
# Optional env:
#   BASESCAN_API_KEY       — if set, verifies contracts on Basescan
#   SWAP_ROUTER            — override default V3 SwapRouter (don't use SwapRouter02)
#   WETH                   — override default Base WETH9
#   POOL_DENOMINATION_WEI  — privacy-pool deposit face value (default 0.1 ETH;
#                            IMMUTABLE post-deploy — fixed denominations are
#                            what make deposits unlinkable)

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
NETWORK="base mainnet"
CHAIN_ID=8453
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${REPO_ROOT}/contracts"
MANIFEST="${CONTRACTS_DIR}/deployed_base.json"
BASESCAN_BASE="https://basescan.org"

log() { printf '[deploy_base] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ─── Preflight ────────────────────────────────────────────────────────────────
command -v forge >/dev/null 2>&1 || die "forge not found (install with foundryup)."
command -v cast  >/dev/null 2>&1 || die "cast not found (install with foundryup)."
[ -d "${CONTRACTS_DIR}/src" ] || die "contracts/src not found at ${CONTRACTS_DIR}/src"

[ -n "${BASE_RPC_URL:-}" ]         || die "BASE_RPC_URL is not set (see contracts/.env.example)."
[ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is not set (see contracts/.env.example)."
[ -n "${FEE_RECIPIENT:-}" ]        || die "FEE_RECIPIENT is not set — this is IMMUTABLE after deploy (see contracts/.env.example)."

# Resolve the deployer address from the private key (does NOT broadcast).
DEPLOYER_ADDR="$(cast wallet address "${DEPLOYER_PRIVATE_KEY}" 2>/dev/null || true)"
[ -n "${DEPLOYER_ADDR}" ] || die "Could not derive deployer address from DEPLOYER_PRIVATE_KEY."

log "Deployer address: ${DEPLOYER_ADDR}"
log "RPC:              ${BASE_RPC_URL}"
log "Fee recipient:    ${FEE_RECIPIENT} (IMMUTABLE — no setter exists)"

# Funded balance check — refuse to proceed on zero gas.
BALANCE="$(cast balance "${DEPLOYER_ADDR}" --rpc-url "${BASE_RPC_URL}" 2>/dev/null || true)"
log "Deployer balance: ${BALANCE:-<unreachable>} wei"
if [ -z "${BALANCE}" ] || [ "${BALANCE}" = "0" ]; then
    die "Deployer has zero balance on ${NETWORK}. Fund ${DEPLOYER_ADDR} with ETH before deploying."
fi

# ─── Build (fail fast) ─────────────────────────────────────────────────────────
log "Building contracts (fail fast on compile regression)..."
( cd "${CONTRACTS_DIR}" && forge build )

# ─── Confirmation gate ────────────────────────────────────────────────────────
echo "" >&2
echo "============================================================" >&2
echo "  UPL DEPLOY — ${NETWORK} (chainId ${CHAIN_ID})" >&2
echo "============================================================" >&2
echo "  Deployer (owner + relayer): ${DEPLOYER_ADDR}" >&2
echo "  Fee recipient (IMMUTABLE):  ${FEE_RECIPIENT}" >&2
echo "  SwapRouter:                 ${SWAP_ROUTER:-0xE592427A0AEce92De3Edee1F18E0157C05861564 (default V3)}" >&2
echo "  WETH:                       ${WETH:-0x4200000000000000000000000000000000000006 (default Base WETH9)}" >&2
echo "  Pool denomination (IMMUTABLE): ${POOL_DENOMINATION_WEI:-100000000000000000} wei (default 0.1 ETH)" >&2
echo "" >&2
echo "  Contracts to deploy:" >&2
echo "    1. StealthAddressRegistry  (no args, no owner)" >&2
echo "    2. PrivacyRelayer          (deployer = owner + relayer)" >&2
echo "    3. UniswapPrivacyWrapper   (swapRouter, WETH, feeRecipient — all immutable)" >&2
echo "    4. Groth16Verifier         (no args; snarkjs-generated withdraw.circom verifier)" >&2
echo "    5. PrivacyPool             (denomination, verifier — both immutable)" >&2
echo "" >&2
echo "  WARNING: feeRecipient AND pool denomination CANNOT be changed after deploy." >&2
echo "  WARNING: This spends real gas on Base mainnet." >&2
echo "============================================================" >&2
echo "" >&2
read -r -p "Type 'DEPLOY' to confirm and broadcast: " CONFIRM
[ "${CONFIRM}" = "DEPLOY" ] || die "Aborted — nothing was broadcast."

# ─── Deploy ───────────────────────────────────────────────────────────────────
# Clean any stale manifest before the deploy so a failed run doesn't leave
# a partial/old deployed_base.json lying around.
rm -f "${MANIFEST}"

log "Broadcasting Deploy.s.sol to ${NETWORK}..."
( cd "${CONTRACTS_DIR}" && forge script script/Deploy.s.sol \
    --rpc-url "${BASE_RPC_URL}" \
    --private-key "${DEPLOYER_PRIVATE_KEY}" \
    --broadcast )

# The script writes deployed_base.json inside contracts/ (fs_permissions).
[ -f "${MANIFEST}" ] || die "deployed_base.json was not written — check forge script output above."

# ─── Provenance enrichment + Forge quirk merge ─────────────────────────────────
# Forge's `vm.writeJson` quirk on real broadcasts persists only
# `chainId` (the on-chain addresses console-print but never make it
# to the JSON). The P3.4 hand-merge worked around it once. The new
# scripts/merge_deploy_manifest.py reads forge's broadcast/.../run-latest.json
# and merges the actual addresses + provenance into the manifest.
# Hard-fails if any P3 contract address is missing — we'd rather ship
# nothing than ship a partial manifest.
GIT_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo 'unknown')"
BROADCAST_DIR="${CONTRACTS_DIR}/broadcast/Deploy.s.sol"

# Convert paths for whatever Python the host has available. This handles
# git-bash on Windows (where '${MANIFEST}' is '/c/Users/...' which native
# python can't read) AND native Windows python (where '${MANIFEST}' is
# 'C:\\Users\\...'). The merge script handles both internally too but we
# normalise to a python-friendly form upfront.
if command -v cygpath >/dev/null 2>&1; then
    MANIFEST_FOR_PY="$(cygpath -m "${MANIFEST}")"
    REPO_ROOT_FOR_PY="$(cygpath -m "${REPO_ROOT}")"
    BROADCAST_DIR_FOR_PY="$(cygpath -m "${BROADCAST_DIR}")"
else
    MANIFEST_FOR_PY="${MANIFEST}"
    REPO_ROOT_FOR_PY="${REPO_ROOT}"
    BROADCAST_DIR_FOR_PY="${BROADCAST_DIR}"
fi

if ! python3 "${REPO_ROOT}/scripts/merge_deploy_manifest.py" \
        "${REPO_ROOT_FOR_PY}" \
        "${BROADCAST_DIR_FOR_PY}" \
        "${MANIFEST_FOR_PY}" \
        "${CHAIN_ID}" >&2; then
    die "Post-broadcast merge failed (see merge_deploy_manifest.py output). "\
        "Without this merge the manifest would be missing the deployed "\
        "contract addresses. Halting before any Basescan verification."
fi

log "Manifest enriched: deployedBase.json now has the real on-chain addresses + provenance (commit ${GIT_COMMIT:0:12})"
log "Manifest written: ${MANIFEST}"

# ─── Optional Basescan verification ───────────────────────────────────────────
if [ -n "${BASESCAN_API_KEY:-}" ]; then
    log "BASESCAN_API_KEY detected — verifying contracts on Basescan..."

    # Read the deployed addresses from the manifest.
    REGISTRY_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['stealth_registry'])")"
    RELAYER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_relayer'])")"
    WRAPPER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['uniswap_wrapper'])")"
    VERIFIER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_verifier'])")"
    POOL_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_pool'])")"

    SWAP_ROUTER_VAL="${SWAP_ROUTER:-0xE592427A0AEce92De3Edee1F18E0157C05861564}"
    WETH_VAL="${WETH:-0x4200000000000000000000000000000000000006}"
    # PrivacyPool constructor args: (uint256 denomination, address verifier).
    # denomination defaults to 0.1 ETH (1e17 wei) — must match Deploy.s.sol.
    POOL_DENOMINATION_VAL="${POOL_DENOMINATION_WEI:-100000000000000000}"

    log "Verifying StealthAddressRegistry at ${REGISTRY_ADDR}..."
    ( cd "${CONTRACTS_DIR}" && forge verify-contract \
        "${REGISTRY_ADDR}" StealthAddressRegistry \
        --chain-id "${CHAIN_ID}" \
        --verifier-url "https://api.basescan.org/api" \
        --verifier etherscan \
        --etherscan-api-key "${BASESCAN_API_KEY}" ) || log "WARN: StealthAddressRegistry verify may be pending (check Basescan)."

    log "Verifying PrivacyRelayer at ${RELAYER_ADDR}..."
    ( cd "${CONTRACTS_DIR}" && forge verify-contract \
        "${RELAYER_ADDR}" PrivacyRelayer \
        --chain-id "${CHAIN_ID}" \
        --verifier-url "https://api.basescan.org/api" \
        --verifier etherscan \
        --etherscan-api-key "${BASESCAN_API_KEY}" ) || log "WARN: PrivacyRelayer verify may be pending (check Basescan)."

    log "Verifying UniswapPrivacyWrapper at ${WRAPPER_ADDR}..."
    ( cd "${CONTRACTS_DIR}" && forge verify-contract \
        "${WRAPPER_ADDR}" UniswapPrivacyWrapper \
        --constructor-args "${SWAP_ROUTER_VAL}" "${WETH_VAL}" "${FEE_RECIPIENT}" \
        --chain-id "${CHAIN_ID}" \
        --verifier-url "https://api.basescan.org/api" \
        --verifier etherscan \
        --etherscan-api-key "${BASESCAN_API_KEY}" ) || log "WARN: UniswapPrivacyWrapper verify may be pending (check Basescan)."

    log "Verifying Groth16Verifier at ${VERIFIER_ADDR}..."
    ( cd "${CONTRACTS_DIR}" && forge verify-contract \
        "${VERIFIER_ADDR}" Groth16Verifier \
        --chain-id "${CHAIN_ID}" \
        --verifier-url "https://api.basescan.org/api" \
        --verifier etherscan \
        --etherscan-api-key "${BASESCAN_API_KEY}" ) || log "WARN: Groth16Verifier verify may be pending (check Basescan)."

    log "Verifying PrivacyPool at ${POOL_ADDR}..."
    ( cd "${CONTRACTS_DIR}" && forge verify-contract \
        "${POOL_ADDR}" PrivacyPool \
        --constructor-args "${POOL_DENOMINATION_VAL}" "${VERIFIER_ADDR}" \
        --chain-id "${CHAIN_ID}" \
        --verifier-url "https://api.basescan.org/api" \
        --verifier etherscan \
        --etherscan-api-key "${BASESCAN_API_KEY}" ) || log "WARN: PrivacyPool verify may be pending (check Basescan)."
else
    log "BASESCAN_API_KEY not set — skipping Basescan verification (optional)."
fi

# ─── Post-deploy summary ──────────────────────────────────────────────────────
REGISTRY_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['stealth_registry'])")"
RELAYER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_relayer'])")"
WRAPPER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['uniswap_wrapper'])")"
VERIFIER_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_verifier'])")"
POOL_ADDR="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['base']['privacy_pool'])")"

echo "" >&2
echo "============================================================" >&2
echo "  DEPLOY COMPLETE — ${NETWORK}" >&2
echo "============================================================" >&2
echo "  StealthAddressRegistry:  ${BASESCAN_BASE}/address/${REGISTRY_ADDR}" >&2
echo "  PrivacyRelayer:          ${BASESCAN_BASE}/address/${RELAYER_ADDR}" >&2
echo "  UniswapPrivacyWrapper:   ${BASESCAN_BASE}/address/${WRAPPER_ADDR}" >&2
echo "  Groth16Verifier:         ${BASESCAN_BASE}/address/${VERIFIER_ADDR}" >&2
echo "  PrivacyPool:             ${BASESCAN_BASE}/address/${POOL_ADDR}" >&2
echo "" >&2
echo "  Manifest: ${MANIFEST}" >&2
echo "" >&2
echo "  Next steps:" >&2
echo "    1. If using a dedicated relayer hot-wallet, rotate the relayer:" >&2
echo "       cast send ${RELAYER_ADDR} 'setRelayer(address)' <RELAYER_WALLET> \\" >&2
echo "         --rpc-url \${BASE_RPC_URL} --private-key \${DEPLOYER_PRIVATE_KEY}" >&2
echo "    2. Restart the backend (or push to trigger Azure redeploy) so" >&2
echo "       it reads deployed_base.json at import time." >&2
echo "    3. Verify the /api/deployments endpoint reports the real addresses." >&2
echo "    4. PrivacyPool is live — P3.5 wires the backend ZK endpoints" >&2
echo "       (/api/zk-pool/deposit, /api/zk-pool/state) to this address." >&2
echo "============================================================" >&2
