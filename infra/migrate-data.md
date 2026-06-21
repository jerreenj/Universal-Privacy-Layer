# Data Migration — Hostinger VPS MongoDB → Azure Cosmos DB

> **Goal:** Move all 24 collections of `upl_database` from the live VPS to Azure
> Cosmos DB with **zero data loss**. Verified by per-collection document counts.
>
> **Who does what:** You run a few copy-paste commands on the VPS (Phase A).
> ZCode/Azure side handles restore + verification (Phase B). The VPS stays
> **running and unchanged** throughout — it's a hot backup until you tear it down.

## Prerequisites

- Phase 1 (Azure provisioning) must be complete — you'll have a Cosmos account name.
- The VPS must be reachable. You can use the Hostinger web terminal (no SSH client needed).

---

## Phase A — Export from the VPS (YOU do this, ~5 min)

### A1. Open the VPS terminal
Hostinger dashboard → your VPS → **"VNC"/"Terminal"** (web-based shell), or SSH in.
Log in as `root`.

### A2. Make sure `mongodump` is installed
```bash
which mongodump || (apt-get update && apt-get install -y mongodb-database-tools)
```
If `apt` can't find it, download directly:
```bash
# Replace ubuntu2204 with your distro codename if different (cat /etc/os-release)
wget -qO- "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.9.4.deb" -o tools.deb
dpkg -i tools.deb
```

### A3. Find your MongoDB connection string
The app on the VPS reads `MONGO_URL`. Find it:
```bash
grep -rh "MONGO_URL" /root/app/ 2>/dev/null    # likely in a .env or docker run command
docker exec privacycloak env | grep MONGO_URL  # if it's in the running container env
```
You'll get something like `mongodb://localhost:27017` or `mongodb://user:pass@localhost:27017`.
Copy it.

### A4. Dump the database
Replace `<MONGO_URL>` with what you found:
```bash
cd /root
mongodump --uri="<MONGO_URL>" --db=upl_database --out=/root/dump --numParallelCollections=1
```
This creates `/root/dump/upl_database/` with one `.bson` + `.json` per collection.

### A5. Verify the dump looks sane
```bash
ls /root/dump/upl_database/ | wc -l     # should be ~48 files (24 collections × 2)
du -sh /root/dump/upl_database/          # total size
```

### A6. Get the dump off the VPS — two options

**Option 1 (small dump, < 50 MB): tar + base64 + copy-paste**
```bash
cd /root/dump && tar czf /tmp/dump.tgz upl_database/
ls -lh /tmp/dump.tgz    # check size
# Then download via Hostinger's file manager (Browser → File Manager),
# or use scp from your own machine:
#   scp root@<VPS_IP>:/tmp/dump.tgz .
```

**Option 2 (larger dump): download directly**
Use Hostinger's **File Manager** (Browser UI) to navigate to `/tmp/dump.tgz`
and click Download, or run this on your **local** machine:
```bash
scp root@<VPS-IP>:/tmp/dump.tgz C:\Users\AGBS Studio\ZCodeProject\
```

### A7. Tell ZCode the dump is ready
Once the `.tgz` is on your local machine (or you've placed it somewhere ZCode
can read), say **"dump is at <path>"**. Phase B (below) runs from there.

---

## Phase B — Restore into Cosmos (ZCode runs this)

### B1. Unpack the dump
```bash
cd C:\Users\AGBS Studio\ZCodeProject
tar xzf dump.tgz      # → ./upl_database/<collection>.bson ...
```

### B2. Restore into Cosmos
```bash
# Get the Cosmos connection string (requires az CLI logged in)
COSMOS_CONN=$(az cosmosdb keys list \
  --name <COSMOS_ACCOUNT> --resource-group rg-privacycloak \
  --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)

mongorestore \
  --uri="$COSMOS_CONN" \
  --db=upl_database \
  --numParallelCollections=1 \
  --stopOnError \
  /path/to/upl_database/
```

**Note on Cosmos quirks:**
- Cosmos Mongo API does **not** support `retrywrites=true`. The connection string
  from Azure already omits it — don't add it back.
- If `mongorestore` complains about `_id` conflicts, the collection was created
  by the app already; use `--drop` on a fresh re-run (only if you're sure it's empty/throwaway).

### B3. Recreate the 3 indexes
Cosmos sometimes needs indexes re-declared after a restore. Run this Python snippet
(or `mongosh`):
```bash
mongosh "$COSMOS_CONN/upl_database?ssl=true&replicaSet=globaldb" --eval '
  db.sessions.createIndex({ token: 1 }, { unique: true });
  db.sessions.createIndex({ expires_at: 1 });
  db.encrypted_messages.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  print("indexes recreated");
'
```

### B4. Verify counts match (the critical check)
For each of the 24 collections, the Cosmos count must equal the VPS count.
```bash
infra/verify-counts.sh   # compares VPS dump vs Cosmos (see script header)
```
Migration is **only done** when every collection shows `MATCH`. Any `MISMATCH`
means we re-investigate before cutover. The full expected collection list:

```
sessions  encrypted_messages  transactions      wallets
stealth_addresses  receipts  privacy_wallets    nft_proxies
disposable_approvals  contract_proxies  zkp_inputs  zkp_proofs
cross_chain_splits  messaging_keys  multisig_wallets  api_keys
defi_trades  stealth_rotation  stealth_meta  address_book
zk_commitments  error_logs  stealth_announcements  payment_transactions
```

### B5. Critical Cosmos-compatibility test
Before declaring done, exercise the one known-risky operation: the double-nested
positional update on `multisig_wallets.proposals.$.signatures` (server.py:2021).
Run a test create-multisig → add-signature flow against the Azure URL and confirm
it succeeds. If it fails, Cosmos rejects the nested positional — we'd then either
(a) restructure that update (small code change) or (b) keep that collection on
a separate MongoDB Atlas instance. (Recon suggests it'll work; this just confirms.)

---

## Rollback (if anything goes wrong)
- The VPS is **untouched**. To roll back, just don't switch DNS.
- Cosmos can be deleted (`az group delete -n rg-privacycloak`) with zero impact
  on the live app.
- The mongodump tarball is itself a backup — keep it.
