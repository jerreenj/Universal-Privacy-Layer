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

# Copy backend code
COPY backend/ ./backend/

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

EXPOSE ${PORT}

# Run from backend dir so imports resolve simply
CMD sh -c "cd /app/backend && uvicorn server:app --host 0.0.0.0 --port ${PORT}"


