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

# Install Node.js + npm + snarkjs + circomlibjs for the M2 server-side
# Groth16 prover. `npm install -g` writes into /usr/local/lib/node_modules
# so /app/scripts/zk_pool_prover.js can `require("snarkjs")` against
# the global module path under all Node versions. Mount zkey + wasm
# below so the backend can find them at the documented defaults
# (/app/backend/zk_artifacts/withdraw_final.zkey +
#  /app/backend/zk_artifacts/withdraw_js/withdraw.wasm).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g snarkjs@^0.7.5 circomlibjs@^0.5.2 \
 && rm -rf /var/lib/apt/lists/*

# Copy backend code
COPY backend/ ./backend/

# Copy the Groth16 prover script into the backend image at the
# documented /app/scripts/ path (the backend's /api/zk-pool/prove
# endpoint hard-codes /app/scripts/zk_pool_prover.js as the node
# subprocess target).
COPY scripts/zk_pool_prover.js ./scripts/zk_pool_prover.js

# Mount the snarkjs artifacts (zkey + was) into the backend image
# so the prover has everything it needs without re-running the
# Powers-of-Tau ceremony. These files are gitignored by default —
# the build context must include them via a separate sync step
# or the Bazel-like artefact promotion pipeline. If absent the
# backend still runs; /api/zk-pool/prove-options returns
# backend_kind=browser and the in-browser snarkjs WASM path
# takes over (current default until the next deploy bundles them).
COPY contracts/circuits/build/withdraw_final.zkey  ./backend/zk_artifacts/withdraw_final.zkey
COPY contracts/circuits/build/withdraw_js/        ./backend/zk_artifacts/withdraw_js/

# Copy the Node prover runner script into the backend image (so
# /api/zk-pool/prove -> subprocess can find it).
# (We COPY the same script a second time below to /app/scripts so
# the absolute path matched in server.py (/app/scripts/zk_pool_prover.js)
# is correct. Idempotent.)

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


