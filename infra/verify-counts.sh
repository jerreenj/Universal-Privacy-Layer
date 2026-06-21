#!/usr/bin/env bash
# =============================================================================
# verify-counts.sh — confirm data migration (VPS → Cosmos) lost nothing.
# =============================================================================
# Compares document counts per collection between:
#   - the mongodump folder (source-of-truth from the VPS), AND
#   - the live Azure Cosmos DB.
#
# Each collection must show MATCH. Any MISMATCH means we stop and investigate
# before declaring the migration complete.
#
# USAGE:
#   bash infra/verify-counts.sh /path/to/dump/upl_database
#
#   (Cosmos connection string is read from $MONGO_URL, or fetched via az if
#    COSMOS_ACCOUNT is set.)
# =============================================================================
set -euo pipefail

DUMP_DIR="${1:?usage: verify-counts.sh <path-to-dumped-upl_database>}"
[ -d "$DUMP_DIR" ] || { echo "❌ dump dir not found: $DUMP_DIR"; exit 2; }

# Get Cosmos connection string
if [ -z "${MONGO_URL:-}" ]; then
  : "${COSMOS_ACCOUNT:?set MONGO_URL or COSMOS_ACCOUNT}"
  : "${RESOURCE_GROUP:=rg-privacycloak}"
  MONGO_URL=$(az cosmosdb keys list --name "$COSMOS_ACCOUNT" -g "$RESOURCE_GROUP" \
    --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)
fi
command -v mongosh >/dev/null || { echo "❌ mongosh not installed"; exit 2; }

# The 24 expected collections (from server.py recon)
COLLECTIONS=(
  sessions encrypted_messages transactions wallets stealth_addresses
  receipts privacy_wallets nft_proxies disposable_approvals contract_proxies
  zkp_inputs zkp_proofs cross_chain_splits messaging_keys multisig_wallets
  api_keys defi_trades stealth_rotation stealth_meta address_book
  zk_commitments error_logs stealth_announcements payment_transactions
)

printf "%-26s %10s %10s   %s\n" "COLLECTION" "DUMP" "COSMOS" "STATUS"
printf "%-26s %10s %10s   %s\n" "----------" "----" "------" "------"

ALL_OK=1
for c in "${COLLECTIONS[@]}"; do
  # Count in dump: number of documents = parse the .metadata.json "nIndexes"/n
  # Simpler: count records by walking the .bson. Easiest robust method is
  # bsondump | wc -l on the .bson file.
  BSON="$DUMP_DIR/$c.bson"
  if [ -f "$BSON" ]; then
    DUMP_COUNT=$(bsondump "$BSON" 2>/dev/null | wc -l | tr -d ' ')
  else
    DUMP_COUNT="MISSING"
  fi

  # Count in Cosmos
  COSMOS_COUNT=$(mongosh "$MONGO_URL/upl_database?ssl=true&replicaSet=globaldb&retrywrites=false" \
    --quiet --eval "db.getCollection('$c').countDocuments()" 2>/dev/null \
    | tr -d ' \r\n' || echo "ERR")

  if [ "$DUMP_COUNT" = "$COSMOS_COUNT" ]; then
    STATUS="✅ MATCH"
  else
    STATUS="❌ MISMATCH"
    ALL_OK=0
  fi
  printf "%-26s %10s %10s   %s\n" "$c" "$DUMP_COUNT" "$COSMOS_COUNT" "$STATUS"
done

echo
if [ "$ALL_OK" = "1" ]; then
  echo "✅ ALL COLLECTIONS MATCH — migration verified, zero data loss."
  exit 0
else
  echo "❌ ONE OR MORE COLLECTIONS MISMATCH — investigate before cutover."
  echo "   Common causes: mongorestore partial failure, TTL already deleting"
  echo "   (encrypted_messages has a 72h TTL — re-dump if it's been days),"
  echo "   or a collection that didn't exist in the dump (cosmos created empty)."
  exit 1
fi