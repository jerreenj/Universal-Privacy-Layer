#!/usr/bin/env bash
# sync_relayer_secret.sh — Sync the PrivacyRelayer hot-wallet key
# into the Azure Container App so the customer-pilot SEND path can
# sign with the dedicated hot-wallet EOA (0x2d82E56f...) instead of
# reverting with "Not authorised relayer".
#
# Called from .github/workflows/deploy-azure.yml (Step 6a). Sets
# the key as a Container App secret "relayer-private-key" then
# flips the env var RELAYER_PRIVATE_KEY to secretref:relayer-private-key.
# Idempotent — running twice is safe (az cli no-ops on unchanged state).
#
# Args (positional):
#   $1  ACA_RESOURCE_GROUP  (e.g. rg-privacycloak)
#   $2  ACA_APP_NAME        (e.g. app-privacycloak)
#   $3  RELAYER_PRIVATE_KEY (0x-prefixed 64-char hex)
#
# Exit 0 on success. Exit 1 on az cli failure.

set -eu
RG="$1"
APP="$2"
KEY="$3"

echo "[sync_relayer_secret] ACA_RESOURCE_GROUP=$RG  ACA_APP_NAME=$APP"
echo "[sync_relayer_secret] setting Container App secret relayer-private-key"

az containerapp secret set \
  --resource-group "$RG" \
  --name "$APP" \
  --secrets "relayer-private-key=$KEY"

echo "[sync_relayer_secret] flipping env var RELAYER_PRIVATE_KEY to secretref"

az containerapp update \
  --resource-group "$RG" \
  --name "$APP" \
  --set-env-vars "RELAYER_PRIVATE_KEY=secretref:relayer-private-key"

echo "[sync_relayer_secret] done; backend /api/relayer/submit now signs with hot wallet"
