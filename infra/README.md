# Infrastructure Guide — Universal Privacy Layer on Azure

> Plain-English ops guide. Written for someone who doesn't code. If you can
> follow a recipe, you can run this.

## What lives where

```
Your laptop ──git push──▶ GitHub ──auto-build──▶ Azure (app + database)
                                                      │
                                            Live at https://privacycloak.in
```

| Thing | Where | Who manages it |
|------|-------|----------------|
| Code | GitHub repo `jerreenj/Universal-Privacy-Layer` | You + ZCode |
| Database | Azure Cosmos DB (`upl_database`) | Azure (managed) |
| Running app | Azure Container Apps (`app-privacycloak`) | Azure (managed) |
| Image storage | Azure Container Registry (`acrprivacycloak`) | Azure (managed) |
| Secrets | Azure (encrypted, on the Container App) | Only you rotate them |
| Domain | Your registrar (privacycloak.in DNS) | You |

**Nothing runs on your laptop.** The laptop is just where you (or ZCode) edit
code and `git push`. The actual app runs in Azure 24/7.

---

## The everyday workflow (after setup is done)

```
1. You/ZCode edit the code
2. git push origin main
3. GitHub Actions auto-builds + deploys (2-5 min)
4. Watch the green check at: github.com/jerreenj/Universal-Privacy-Layer/actions
5. Done. The live site updates itself.
```

If the build fails, you get a red ❌ in the Actions tab and the **old version
keeps running** (zero-downtime — a failed deploy never takes the site down).
You tell ZCode "the deploy failed" and we fix it.

---

## Common tasks (no coding required)

### "I want to see if my site is up"
Visit:
```
https://privacycloak.in/api/health
```
You should see `{"status":"healthy",...}`. If it errors, the app is down.

### "I want to see the deploy logs / what just deployed"
1. Go to: https://github.com/jerreenj/Universal-Privacy-Layer/actions
2. Click the top run → watch the steps. Green = success.

### "I want to roll back to the previous version"
Every deploy keeps the old image in ACR. To revert:
```bash
# Find the previous image tag (each commit SHA is a tag):
az acr repository show-tags --name acrprivacycloak<rand> --repository privacycloak --orderby time_desc -o table

# Deploy the previous one:
az containerapp update -g rg-privacycloak -n app-privacycloak \
  --image acrprivacycloak<rand>.azurecr.io/privacycloak:<old-sha>
```
Or just tell ZCode "roll back to the previous deploy" and we'll run it.

### "I want to change the access code (ACCESS_CODE)"
```bash
az containerapp secret set -g rg-privacycloak -n app-privacycloak \
  --secrets access-code=<NEW-CODE>
az containerapp update -g rg-privacycloak -n app-privacycloak   # restart to apply
```
Then the new code works at the login screen. The old code stops working instantly.

### "I want to see how much I'm spending"
1. https://portal.azure.com → your subscription → **Cost analysis**
2. There's also a $50/month budget alert (configured in Phase 1) that emails you
   before costs drift.

### "The site is slow / getting more traffic"
Container Apps autoscales from 1 to 3 replicas automatically (configured). If
you need more, tell ZCode — we bump `--max-replicas`. Cost goes up roughly
linearly with replicas.

---

## Where secrets live (and where they DON'T)

| Secret | Location | NOT in |
|--------|----------|--------|
| `MONGO_URL` (Cosmos connection) | Azure Container App secret (encrypted) | Code, git, README |
| `ACCESS_CODE` | Azure Container App secret (encrypted) | Code, git, README |
| GitHub→Azure auth | OIDC federation (no stored secret) | Anywhere — it's a trust relationship |
| Your Azure login | Your Microsoft account / browser session | This repo |

**If someone steals the repo, they get nothing.** The app code is useless without
the Azure secrets, which only Azure holds.

---

## How to rotate secrets (do this if anything leaks)

```bash
# Rotate Cosmos key (if you suspect the connection string leaked):
az cosmosdb keys regenerate -g rg-privacycloak -n cosmos-privacycloak --key-kind primary
# Then update MONGO_URL on the app:
NEW_CONN=$(az cosmosdb keys list -g rg-privacycloak -n cosmos-privacycloak \
  --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)
az containerapp secret set -g rg-privacycloak -n app-privacycloak --secrets mongo-url=$NEW_CONN
az containerapp update -g rg-privacycloak -n app-privacycloak   # apply

# Rotate ACCESS_CODE: see "change access code" above.
```

---

## Cost expectations

| Resource | Tier | ~Cost/month |
|----------|------|-------------|
| Cosmos DB | 400 RU/s provisioned | $25 |
| Container Apps | 1-3 replicas, min 1 | $10-30 |
| Container Registry | Basic | $5 |
| Storage, logs, egress | (small) | $5 |
| **Total** | | **~$45-65/mo** |

Budget alert fires at $50/mo. If you see that email, tell ZCode — we either
right-size or investigate a traffic spike.

---

## Emergency contacts / what to do if the site is down

1. **Check health**: `https://privacycloak.in/api/health`
2. **Check Actions**: https://github.com/jerreenj/Universal-Privacy-Layer/actions
   — did the last deploy fail?
3. **Check Azure**: https://portal.azure.com → resource group `rg-privacycloak` →
   Container App `app-privacycloak` → "Revision management" (is a revision
   active? did it crash-loop?)
4. **Roll back** (above) if needed.
5. **Tell ZCode** with a screenshot of whatever error you see.

The VPS at your hosting provider is kept as a **hot backup** until you're
confident Azure is solid. If Azure has a disaster, you can repoint DNS back to
the VPS in minutes.

---

## Files in this folder

| File | Purpose |
|------|---------|
| `azure-provision.sh` | The script that built everything in Azure. Reproducible. |
| `deploy-azure.yml` (in `.github/workflows/`) | The push-to-deploy pipeline. |
| `migrate-data.md` | Runbook for the VPS→Cosmos data move. |
| `verify-counts.sh` | Verifies the data migration lost nothing. |
| `README.md` | This file. |

---

## Lock-in / "can I leave Azure later?"

**Yes, easily.** The app is a Docker container using the MongoDB API. To move:
- **AWS**: build the image → run on ECS/App Runner → use DocumentDB (Mongo-compatible).
- **Back to VPS**: `docker run` the image → run MongoDB on the VPS. Same as before.
- **Other**: anywhere that runs Docker + MongoDB.

No proprietary Azure services are baked into the app itself. Azure is just the host.
