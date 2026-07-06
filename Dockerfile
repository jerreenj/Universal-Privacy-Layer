# ── Stage 1: Build React Frontend ──────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/yarn.lock ./
# --frozen-lockfile: fail the build if package.json and yarn.lock are out of
# sync, rather than silently re-resolving (which made every build
# non-reproducible and let deps drift). Remove the previous
# `2>/dev/null || yarn install` fallback for the same reason — it masked
# real drift by doing a fresh resolve.
RUN yarn install --frozen-lockfile

COPY frontend/ ./

# Empty BACKEND_URL = relative paths (/api/*), perfect for same-domain deploy
ENV REACT_APP_BACKEND_URL=""
RUN yarn build

# ── Stage 2: Python Backend + Static Frontend ─────────────────────
FROM python:3.11

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js + npm + snarkjs for the M2 server-side Groth16
# prover. `npm install -g` writes into /usr/local/lib/node_modules
# so /app/scripts/zk_pool_prover.js can `require("snarkjs")`
# against the global module path. circomlibjs is NOT required
# (snarkjs 0.7+ ships its own Poseidon impl). Version pinned
# to the latest available on npm as of 2026-07-06 — the ^0.5.2
# circomlibjs once requested here does NOT exist on npm
# (that package only goes up to ^0.1.7; pinning that instead
# would have masked the bug for weeks).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g snarkjs@^0.7.6 \
 && rm -rf /var/lib/apt/lists/*

# Copy backend code
COPY backend/ ./backend/

# Copy the Groth16 prover script into the backend image at the
# documented /app/scripts/ path (the backend's /api/zk-pool/prove
# endpoint hard-codes /app/scripts/zk_pool_prover.js as the node
# subprocess target).
COPY scripts/zk_pool_prover.js ./scripts/zk_pool_prover.js

# OPTIONAL: snarkjs artefacts (withdraw_final.zkey +
# withdraw_js/withdraw.wasm) for the M2 server-side prover.
# These files are gitignored — the public-CI build context does
# NOT contain them. The DEFAULT backend image ships WITHOUT the
# artefacts; /api/zk-pool/prove-options then reports
# backend_kind=browser and the in-browser snarkjs WASM path takes
# over (current customer-pilot behaviour). Operators who want the
# server prover flip should:
#   1. Build locally:  cd contracts && bash scripts/zk_powers_of_tau.sh
#      (or `forge build circuits` for a fresh ceremony).
#   2. tar + upload to private Azure blob storage.
#   3. Add a late Dockerfile layer (BEFORE the user cuts an image):
#      COPY zk_artifacts/withdraw_final.zkey \
#           /app/backend/zk_artifacts/withdraw_final.zkey
#      COPY zk_artifacts/withdraw_js \
#           /app/backend/zk_artifacts/withdraw_js
#   4. Set ZK_POOL_PROVER_ENABLED=1 env on the Container App.
# The COPY lines are intentionally absent from the public image so
# the public-CI docker build does NOT fail on missing files.
# We pre-create the directory so server.py's missing-file check
# returns a clean 503 (not a 500 stacktrace) on Day 1.
RUN mkdir -p /app/backend/zk_artifacts/withdraw_js



# Copy built frontend into backend/static for serving
COPY --from=frontend-build /build/frontend/build ./backend/static

# Copy deployment manifests so the backend can read real contract addresses.
# deployed_base.json is force-committed (gitignored by contracts/deployed_*.json)
# because it contains only public contract addresses — no secrets.
# The backend's _load_deployed_addresses() reads it at /app/contracts/deployed_base.json.
COPY contracts/deployed_base.json ./contracts/deployed_base.json

# Sui mainnet manifest (force-committed — gitignored, but only public object IDs).
# The backend's _load_deployed_sui() reads it at /app/scripts/deployed_sui_mainnet.json.
COPY scripts/deployed_sui_mainnet.json ./scripts/deployed_sui_mainnet.json

# Railway injects PORT; default to 8001
ENV PORT=8001
# M2 — opt-in flag for the server-side Groth16 prover. Default off so
# the existing browser-snarkjs path stays the default until the
# operator runs `az containerapp update --env-vars ZK_POOL_PROVER_ENABLED=1`.
ENV ZK_POOL_PROVER_ENABLED=0
ENV ZK_POOL_ZKEY_PATH=/app/backend/zk_artifacts/withdraw_final.zkey
ENV ZK_POOL_WASM_PATH=/app/backend/zk_artifacts/withdraw_js/withdraw.wasm
ENV ZK_POOL_PROVER_TIMEOUT_S=60

EXPOSE ${PORT}

# Run from backend dir so imports resolve simply
CMD sh -c "cd /app/backend && uvicorn server:app --host 0.0.0.0 --port ${PORT}"


