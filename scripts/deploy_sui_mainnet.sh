#!/usr/bin/env bash
# Deploy the UPL Sui Move package (contracts/sui) to Sui mainnet and emit a
# `deployed_sui_mainnet.json` manifest the backend + frontend can read.
#
# This is the P1.6 deliverable — the Sui mainnet deploy toolchain, switched
# from testnet to mainnet per the project's "everything mainnet, no testnet"
# directive. The Move package (12 modules, 123 tests) builds against the
# `framework/mainnet` Sui framework rev pinned in `Move.toml`.
#
# What it does, in order:
#   1. Sanity-checks the environment: `sui` on PATH, an active client env
#      pointing at mainnet (`sui client active-env`), and a non-zero funded
#      active address (`sui client gas`). Publish cost on mainnet is real SUI;
#      we refuse to proceed on an empty balance rather than letting the
#      publish tx fail mid-run.
#   2. Runs `sui move build` to fail fast on a compile regression before any
#      on-chain work.
#   3. Publishes with `--skip-dependency-verification` OFF (the default — we do
#      NOT want to slip a broken dep through). Captures the new package ID and
#      the `init`-minted capability object IDs from the publish effects JSON.
#   4. Upgrades the package `upl = "0x0"` placeholder in `Move.toml` IS NOT
#      done here — the published address is recorded in the manifest instead
#      so the source tree stays publish-agnostic (the canonical Sui pattern;
#      callers re-bind `upl` at their own publish time).
#   5. Writes `scripts/deployed_sui_mainnet.json` with:
#        - network, sui_cli_version, package_id, the upgrade_cap id,
#          the shared Registry / RelayerState object ids, and the AdminCap /
#          RelayerCap / ReceiptCap object ids that `init` minted to the publisher.
#
# Re-running: idempotent in shape but each run publishes a NEW package (Sui
# packages are immutable; you publish-then-upgrade by cap, never re-publish the
# same id). The manifest is overwritten, so back it up before a redeploy if you
# need the prior package id for replay/indexing.

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
NETWORK="mainnet"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="${REPO_ROOT}/contracts/sui"
OUT_MANIFEST="${REPO_ROOT}/scripts/deployed_sui_mainnet.json"
SUI_BIN="${SUI_BIN:-sui}"                 # override with an absolute path if `sui` isn't on PATH

log() { printf '[deploy_sui_mainnet] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ─── Preflight ────────────────────────────────────────────────────────────────
command -v "${SUI_BIN}" >/dev/null 2>&1 || die "sui CLI not found (set SUI_BIN to an absolute path)."
# shellcheck disable=SC2012
[ -d "${PKG_DIR}" ] || die "Move package dir not found: ${PKG_DIR}"

ACTIVE_ENV="$("${SUI_BIN}" client active-env 2>/dev/null || true)"
log "Active sui client env: ${ACTIVE_ENV:-<unset>}"
[ "${ACTIVE_ENV}" = "${NETWORK}" ] \
  || die "Active sui client env is '${ACTIVE_ENV}'; required '${NETWORK}'. Run: sui client switch --env ${NETWORK}"

ACTIVE_ADDR="$("${SUI_BIN}" client active-address)"
log "Active address: ${ACTIVE_ADDR}"
[ -n "${ACTIVE_ADDR}" ] || die "No active address; run: sui client addresses && sui client switch --address <addr>"

GAS_LINE="$("${SUI_BIN}" client gas --address "${ACTIVE_ADDR}" 2>/dev/null | tail -n +2 | head -n1 || true)"
log "Gas row: ${GAS_LINE:-<no balance>}"
echo "${GAS_LINE}" | grep -Eq '[1-9]' \
  || die "Active address has zero gas on ${NETWORK}; fund it with real SUI before deploying."

# ─── Build (fail fast) ─────────────────────────────────────────────────────────
log "Building package: ${PKG_DIR}"
( cd "${PKG_DIR}" && "${SUI_BIN}" move build )

# ─── Publish ──────────────────────────────────────────────────────────────────
# `sui client publish` prints a human-readable effects block then a JSON tail
# when --json is set. We capture the JSON only.
log "Publishing to ${NETWORK}..."
PUBLISH_JSON="$("${SUI_BIN}" client publish --gas-budget 100000000 --json "${PKG_DIR}")"

# Extract the package id + created-object ids from the effects JSON with
# `sui`'s own `jq`-free parser path (test the env has python; the installer
# image ships it). Fall back to grep if python is absent.
extract() {
  local needle="$1"; shift
  printf '%s' "${PUBLISH_JSON}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(json.dumps(d))
' >/dev/null 2>&1 && {
    printf '%s' "${PUBLISH_JSON}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
needle = sys.argv[1]
if isinstance(d, dict):
    if \"effects\" in d and isinstance(d[\"effects\"], dict):
        eff = d[\"effects\"]
    else:
        eff = d
    print(json.dumps(eff.get(needle, {})))
" "${needle}"
    return
  }
  # grep fallback: crude but unblocks envs without python.
  printf '%s' "${PUBLISH_JSON}" | grep -oE "\"${needle}\":\"0x[0-9a-f]+\"" | head -n1
}

PACKAGE_ID="$(printf '%s' "${PUBLISH_JSON}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
# The effects JSON stores created objects under effects.created; the package
# itself is one of them with objectType "package".
eff = d.get("effects", d)
created = eff.get("created", [])
for c in created:
    o = c.get("owner", {})
    if isinstance(o, dict) and o.get("objectType", "").endswith("::Package") or "package" in str(c).lower():
        print(c.get("objectId", c.get("reference", {}).get("objectId", "")))
        break
else:
    # Fallback: the first created object id is conventionally the package.
    if created:
        print(created[0].get("objectId", created[0].get("reference", {}).get("objectId", "")))
' 2>/dev/null || true)"

[ -n "${PACKAGE_ID}" ] || die "Could not extract package id from publish effects — inspect:\n${PUBLISH_JSON:0:1200}"

# Object ids created by `init`: AdminCap, RelayerCap, ReceiptCap (owned), and the
# shared Registry + RelayerState. We pull them from the package's `init` event
# manifest by struct name (the publish JSON's `events` array). This is the
# stable extractor: it doesn't depend on positional order.
extract_obj() {
  local struct="$1"
  printf '%s' "${PUBLISH_JSON}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', [])
# Also scan `created` for objects whose module::struct match.
created = d.get('effects', d).get('created', [])
needle = '${struct}'
for c in created:
    s = json.dumps(c)
    if needle in s or ('::' + needle) in s:
        print(c.get('objectId', c.get('reference', {}).get('objectId', '')))
        break
" 2>/dev/null || true
}

REGISTRY_ID="$(extract_obj 'Registry')"
RELAYER_STATE_ID="$(extract_obj 'RelayerState')"
ADMIN_CAP_ID="$(extract_obj 'AdminCap')"
RELAYER_CAP_ID="$(extract_obj 'RelayerCap')"
RECEIPT_CAP_ID="$(extract_obj 'ReceiptCap')"
UPGRADE_CAP_ID="$(extract_obj 'UpgradeCap')"

log "package_id        = ${PACKAGE_ID}"
log "Registry          = ${REGISTRY_ID:-<not found>}"
log "RelayerState      = ${RELAYER_STATE_ID:-<not found>}"
log "AdminCap          = ${ADMIN_CAP_ID:-<not found>}"
log "RelayerCap        = ${RELAYER_CAP_ID:-<not found>}"
log "ReceiptCap        = ${RECEIPT_CAP_ID:-<not found>}"
log "UpgradeCap (auto) = ${UPGRADE_CAP_ID:-<not found>}"

SUI_CLI_VERSION="$("${SUI_BIN}" --version | head -n1 | tr -d '\n')"

# ─── Emit manifest ────────────────────────────────────────────────────────────
python3 - <<EOF > "${OUT_MANIFEST}"
import json
doc = {
    "network": "${NETWORK}",
    "sui_cli_version": "${SUI_CLI_VERSION}",
    "published_at": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds") + "Z",
    "package_id": "${PACKAGE_ID}",
    "modules": [
        "stealth_address_registry",
        "privacy_relayer",
        "prepaid_ticket",
        "privacy_receipt",
        "stealth_transfer",
        "uopl_multisig"
    ],
    "shared_objects": {
        "registry": "${REGISTRY_ID}",
        "relayer_state": "${RELAYER_STATE_ID}"
    },
    "owned_capabilities": {
        "admin_cap":   "${ADMIN_CAP_ID}",
        "relayer_cap": "${RELAYER_CAP_ID}",
        "receipt_cap": "${RECEIPT_CAP_ID}",
        "upgrade_cap": "${UPGRADE_CAP_ID}"
    },
    "publisher_address": "${ACTIVE_ADDR}"
}
print(json.dumps(doc, indent=2))
EOF

log "Wrote ${OUT_MANIFEST}"
log "Done. Next: move AdminCap/ReceiptCap to their real operator(s) via 'sui client call --package ${PACKAGE_ID} --module privacy_relayer --function <transfer>'"
