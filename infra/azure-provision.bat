@echo off
REM =============================================================================
REM Universal Privacy Layer — Azure provisioning (Windows batch file)
REM =============================================================================
REM Double-click this file or run from cmd.exe to create all Azure resources.
REM It includes role grants that are blocked in the Git Bash environment.
REM =============================================================================

setlocal EnableDelayedExpansion

REM === CONFIGURATION ===
set SUBSCRIPTION_ID=801d842d-4158-4a3f-a0af-a07999f91e1e
set TENANT_ID=9562edec-bed5-43af-b2f6-8eaac78f7ba1
set RESOURCE_GROUP=rg-privacycloak
set LOCATION=eastus
set RAND=801d842d
set COSMOS_ACCOUNT=cospcloak%RAND%azure
set ACR_NAME=acrprivacycloak%RAND%
set LAW_NAME=log-privacycloak
set ENV_NAME=env-privacycloak
set APP_NAME=app-privacycloak
set DB_NAME=upl_database
set UAMI_NAME=uami-github-deploy

echo Setting subscription context...
az account set --subscription %SUBSCRIPTION_ID%

echo Creating resource group...
az group create --name %RESOURCE_GROUP% --location %LOCATION% --tags project=privacycloak managed-by=script -o none

echo Creating Cosmos DB (MongoDB API)...
az cosmosdb create --name %COSMOS_ACCOUNT% --resource-group %RESOURCE_GROUP% --kind MongoDB --server-version 4.2 --default-consistency-level Session --locations regionName=%LOCATION% failoverPriority=0 isZoneRedundant=false -o none

echo Creating Cosmos database...
az cosmosdb mongodb database create --account-name %COSMOS_ACCOUNT% --resource-group %RESOURCE_GROUP% --name %DB_NAME% --throughput 400 -o none

echo Creating Container Registry...
az acr create --name %ACR_NAME% --resource-group %RESOURCE_GROUP% --sku Basic --admin-enabled false -o none

echo Creating Log Analytics workspace...
az monitor log-analytics workspace create --resource-group %RESOURCE_GROUP% --workspace-name %LAW_NAME% -o none

echo Creating Container Apps environment...
for /f "delims=" %%i in ('az monitor log-analytics workspace show --resource-group %RESOURCE_GROUP% --workspace-name %LAW_NAME% --query customerId -o tsv') do set LAW_ID=%%i
for /f "delims=" %%k in ('az monitor log-analytics workspace get-shared-keys --resource-group %RESOURCE_GROUP% --workspace-name %LAW_NAME% --query primarySharedKey -o tsv') do set LAW_KEY=%%k
az containerapp env create --name %ENV_NAME% --resource-group %RESOURCE_GROUP% --location %LOCATION% --logs-workspace-id %LAW_ID% --logs-workspace-key %LAW_KEY% -o none

echo Creating managed identity for GitHub deploy...
for /f "delims=" %%p in ('az identity create --name %UAMI_NAME% --resource-group %RESOURCE_GROUP% --location %LOCATION% --query principalId -o tsv') do set UAMI_PRINCIPAL=%%p

echo Granting AcrPush role...
for /f "delims=" %%a in ('az acr show --name %ACR_NAME% --resource-group %RESOURCE_GROUP% --query id -o tsv') do set ACR_ID=%%a
az role assignment create --assignee %UAMI_PRINCIPAL% --role AcrPush --scope %ACR_ID% -o none 2>nul || echo (may already exist)

echo Granting Contributor role on resource group...
az role assignment create --assignee %UAMI_PRINCIPAL% --role Contributor --scope /subscriptions/%SUBSCRIPTION_ID%/resourceGroups/%RESOURCE_GROUP% -o none 2>nul || echo (may already exist)

echo Setting up OIDC federated credential for GitHub...
REM The federated credential uses an inline JSON policy file
set FED_POLICY={"name":"github-actions-deploy","issuer":"https://token.actions.githubusercontent.com","subject":"repo:jerreenj/Universal-Privacy-Layer:ref:refs/heads/main","audiences":["api://AzureADTokenExchange"]}
az rest --method PUT --uri "https://management.azure.com/subscriptions/%SUBSCRIPTION_ID%/resourceGroups/%RESOURCE_GROUP%/providers/Microsoft.ManagedIdentity/userAssignedIdentities/%UAMI_NAME%/federatedIdentityCredentials/github-actions-deploy?api-version=2023-01-31" --body "%FED_POLICY%" -o none || echo (may already exist)

echo Creating placeholder Container App...
for /f "delims=" %%s in ('az acr show --name %ACR_NAME% --query loginServer -o tsv') do set ACR_SERVER=%%s
REM Use a placeholder image; real image deployed in Phase 3
az containerapp create --name %APP_NAME% --resource-group %RESOURCE_GROUP% --environment %ENV_NAME% --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest --target-port 8001 --ingress external --min-replicas 1 --max-replicas 3 --registry-server %ACR_SERVER% -o none

echo Provisioning complete!
echo.
echo === SUMMARY ===
echo Resource Group: %RESOURCE_GROUP%
echo Cosmos Account: %COSMOS_ACCOUNT%
echo Database: %DB_NAME%
echo ACR: %ACR_NAME%
echo Container App: %APP_NAME%
echo Managed Identity: %UAMI_NAME%
echo.
echo Next steps (after this .bat finishes):
echo   1. Get MONGO_URL from: az cosmosdb keys list --name %COSMOS_ACCOUNT% -g %RESOURCE_GROUP% --type connection-strings -o tsv
echo   2. Build and push the Docker image to ACR
echo   3. Update the Container App with the real image
echo.
pause