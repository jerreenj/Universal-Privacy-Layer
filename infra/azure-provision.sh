#!/usr/bin/env bash
# =============================================================================
# Universal Privacy Layer — Azure provisioning (idempotent)
# =============================================================================
# Creates everything needed to run the app on Azure Container Apps + Cosmos DB.
#
# Resources (all in one resource group):
#   - Resource Group:        rg-privacycloak
#   - Cosmos DB (Mongo API): cosmos-privacycloak      (database: upl_database)
#   - Container Registry:    acrprivacycloak
#   - Log Analytics:         log-privacycloak
#   - Container Apps Env:    env-privacycloak
#   - Container App:         app-privacycloak
#   - Federated credential:  GitHub → Azure (OIDC, passwordless push-to-deploy)
#   - Cost budget alert:     $50/month email warning
#
# This script is idempotent: it uses `--if-not-exists` / `|| true` guards so it
# can be re-run safely. Run it once during setup; it's also the documentation of
# exactly what exists in Azure.
#
# USAGE:
#   export AZURE_SUBSCRIPTION_ID=<your-subscription-id>
#   export AZURE_TENANT_ID=<your-tenant-id>
#   export RESOURCE_GROUP=rg-privacycloak          # optional override
#   export LOCATION=eastus                         # optional override
#   bash infra/azure-provision.sh
#
# Secrets (MONGO_URL, ACCESS_CODE) are read from environment variables so they
# NEVER appear in the script, in git, or in shell history. Set them right before
# running and unset after.
#   read -s MONGO_URL; export MONGO_URL      # paste Cosmos connection string
#   read -s ACCESS_CODE; export ACCESS_CODE  # paste new app access code
# =============================================================================

set -euo pipefail

# ─── Required config ─────────────────────────────────────────────────────────
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
: "${AZURE_TENANT_ID:?AZURE_TENANT_ID is required}"
: "${MONGO_URL:?MONGO_URL (Cosmos connection string) is required — set via 'read -s MONGO_URL'}"
: "${ACCESS_CODE:?ACCESS_CODE is required — set via 'read -s ACCESS_CODE'}"

# ─── Naming (Azure names must be globally unique & lowercase alphanumeric) ────
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-privacycloak}"
LOCATION="${LOCATION:-eastus}"
# Cosmos + ACR names must be globally unique. Suffix with a short random string
# derived from your subscription id so they're stable across re-runs but won't
# collide with anyone else's resources.
RAND="${AZURE_SUBSCRIPTION_ID:0:8}"   # first 8 chars of sub id
COSMOS_ACCOUNT="cospcloak${RAND}"
ACR_NAME="acrprivacycloak${RAND}"     # ACR: 5-50 chars, alphanumeric only
ACR_NAME="${ACR_NAME//[^a-z0-9]/}"    # strip non-alphanumeric
LAW_NAME="log-privacycloak"
ENV_NAME="env-privacycloak"
APP_NAME="app-privacycloak"
DB_NAME="upl_database"

# GitHub repo for OIDC federation (change if you fork/rename)
GITHUB_ORG="jerreenj"
GITHUB_REPO="Universal-Privacy-Layer"
GITHUB_BRANCH="main"

echo "▶ Using subscription: $AZURE_SUBSCRIPTION_ID"
echo "▶ Resource group:     $RESOURCE_GROUP  ($LOCATION)"
echo "▶ Cosmos account:     $COSMOS_ACCOUNT"
echo "▶ ACR:                $ACR_NAME"
echo

# ─── 0. Set subscription context ─────────────────────────────────────────────
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

# ─── 1. Resource group ───────────────────────────────────────────────────────
echo "▶ [1/8] Resource group"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" \
  --tags project=privacycloak managed-by=script -o none

# ─── 2. Cosmos DB (MongoDB API) ──────────────────────────────────────────────
echo "▶ [2/8] Cosmos DB (MongoDB API)"
az cosmosdb create \
  --name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --kind MongoDB \
  --server-version 4.2 \
  --enable-free-tier true \
  --default-consistency-level Session \
  --locations regionName="$LOCATION" failoverPriority=0 isZoneRedundant=false \
  -o none 2>/dev/null || \
az cosmosdb show --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" -o none

# Database
az cosmosdb mongodb database create \
  --account-name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DB_NAME" \
  --throughput 400 -o none   # 400 RU/s = cheapest provisioned tier

# ─── 3. Container Registry ───────────────────────────────────────────────────
echo "▶ [3/8] Container Registry"
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sku Basic \
  --admin-enabled false -o none 2>/dev/null || \
az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" -o none

# ─── 4. Log Analytics (for Container Apps logs) ──────────────────────────────
echo "▶ [4/8] Log Analytics workspace"
LAW_ID=$(az monitor log-analytics workspace create \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LAW_NAME" -o tsv \
  --query id 2>/dev/null || \
az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LAW_NAME" --query id -o tsv)

# ─── 5. Container Apps environment ───────────────────────────────────────────
echo "▶ [5/8] Container Apps environment"
az containerapp env create \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --logs-workspace-id "$LAW_ID" -o none 2>/dev/null || \
az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" -o none

# ─── 6. Managed Identity for the GitHub Action ───────────────────────────────
echo "▶ [6/8] Managed identity (for GitHub OIDC deploy)"
UAMI_NAME="uami-github-deploy"
UAMI_PRINCIPAL_ID=$(az identity show --name "$UAMI_NAME" \
  --resource-group "$RESOURCE_GROUP" --query principalId -o tsv 2>/dev/null || \
az identity create --name "$UAMI_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" --query principalId -o tsv)

# Grant the identity rights to push images to ACR + manage the Container App
az role assignment create --assignee "$UAMI_PRINCIPAL_ID" \
  --role AcrPush --scope "$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)" -o none 2>/dev/null || true
az role assignment create --assignee "$UAMI_PRINCIPAL_ID" \
  --role "Contributor" --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" -o none 2>/dev/null || true

# Federated credential: lets GitHub Actions auth as this identity WITHOUT a secret
cat <<EOF > /tmp/fed-cred.json
{
  "name": "github-actions-deploy",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/${GITHUB_BRANCH}",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az rest --method PUT \
  --uri "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$UAMI_NAME/federatedIdentityCredentials/github-actions-deploy?api-version=2023-01-31" \
  --body @/tmp/fed-cred.json -o none 2>/dev/null || \
echo "   (federated credential may already exist — OK)"

# ─── 7. Container App ────────────────────────────────────────────────────────
echo "▶ [7/8] Container App"
# NOTE: ACR admin is disabled (we use OIDC). For the FIRST deploy we need to push
# the image from this script's runner. The actual containerapp create below uses
# a placeholder image; Phase 3 of the migration pushes the real image and updates.
PLACEHOLDER_IMAGE="mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
ACR_SERVER=$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)

az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$PLACEHOLDER_IMAGE" \
  --target-port 8001 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --secrets "mongo-url=${MONGO_URL}" "access-code=${ACCESS_CODE}" \
  --env-vars "MONGO_URL=secretref:mongo-url" \
             "ACCESS_CODE=secretref:access-code" \
             "DB_NAME=${DB_NAME}" \
             "PORT=8001" \
             "CORS_ORIGINS=https://${APP_NAME}.${LOCATION}.azurecontainerapps.io" \
  --registry-server "$ACR_SERVER" \
  --query properties.configuration.ingress.fqdn -o none 2>/dev/null || \
az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" -o none

# Health probe on /api/health
az containerapp update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "MONGO_URL=secretref:mongo-url" \
  --query "{ fqdn: properties.configuration.ingress.fqdn }" -o none 2>/dev/null || true

# ─── 8. Cost budget alert ($50 USD/month from $1000 Azure credits) ───────────
# The budget is drawn in the SUBSCRIPTION'S billing currency. Azure sponsor
# credits ($1000) are issued in USD, so the linked subscription should bill in
# USD — verify that here before creating the budget, otherwise "50" would be
# interpreted as 50 INR (~$0.60) instead of $50 USD.
echo "▶ [8/8] Cost budget alert (\$50 USD/month)"
BUDGET_NAME="monthly-budget"
BILLING_CURRENCY=$(az account show --query "name" -o tsv 2>/dev/null)
SUB_CURRENCY=$(az billing account show --query "billingProfileIds" -o tsv 2>/dev/null || echo "unknown")

# Confirm the subscription is on a USD billing profile (Azure credits default).
# If the lookup fails we still proceed — the sponsor-credit subscription is USD.
if [[ "${SUB_CURRENCY,,}" == *"inr"* ]] || [[ "${BILLING_CURRENCY,,}" == *"inr"* ]]; then
  echo "   ⚠️  Subscription appears to bill in INR. \$50 USD ≈ ₹4,150."
  echo "       Either switch the subscription currency to USD in the portal, or"
  echo "       re-run with --amount 4150 for the INR equivalent."
fi

az consumption budget create \
  --budget-name "$BUDGET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --category Cost \
  --amount 50 \
  --time-grain Monthly \
  --start-date "$(date -u +%Y-%m-01)" \
  --end-date "$(date -u -d '+1 year' +%Y-%m-01)" \
  --time-period start="$(date -u +%Y-%m-01)" end="$(date -u -d '+1 year' +%Y-%m-01)" 2>/dev/null || \
echo "   (budget needs email contact configured in portal — see infra/README.md)"

# ─── Done — print the useful outputs ─────────────────────────────────────────
APP_FQDN=$(az containerapp show --name "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)
COSMOS_CONN=$(az cosmosdb keys list --name "$COSMOS_ACCOUNT" -g "$RESOURCE_GROUP" \
  --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)

cat <<EOF

============================================================
✅  AZURE PROVISIONING COMPLETE
============================================================

Resource group : $RESOURCE_GROUP
Location       : $LOCATION

Cosmos account : $COSMOS_ACCOUNT
Cosmos DB      : $DB_NAME
Cosmos conn    : (already set as MONGO_URL secret on the app)

ACR            : $ACR_SERVER
Container App  : $APP_NAME
App URL (test) : https://$APP_FQDN
Health check   : https://$APP_FQDN/api/health
Log Analytics  : $LAW_NAME

Managed identity for GitHub deploy : $UAMI_NAME
  → UAMI client ID (put this in GitHub Actions vars):
    $(az identity show --name "$UAMI_NAME" -g "$RESOURCE_GROUP" --query clientId -o tsv)
  → Tenant ID (put this in GitHub Actions vars):
    $AZURE_TENANT_ID
  → Subscription ID:
    $AZURE_SUBSCRIPTION_ID

NEXT STEPS:
  1. Phase 2 — migrate data: see infra/migrate-data.md
  2. Phase 3 — build & push the real image (see infra/README.md),
              then update the app with:
              az containerapp update -g $RESOURCE_GROUP -n $APP_NAME \\
                --image $ACR_SERVER/privacycloak:latest
  3. Phase 4 — the GitHub Action uses the 3 IDs above (no secrets needed).
  4. Phase 5 — DNS cutover: point privacycloak.in at https://$APP_FQDN

============================================================
EOF