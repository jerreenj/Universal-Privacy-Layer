# ── Stage 1: Build React Frontend ──────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

COPY frontend/ ./

# Empty BACKEND_URL = relative paths (/api/*), perfect for same-domain deploy
ENV REACT_APP_BACKEND_URL=""
RUN yarn build

# ── Stage 2: Python Backend + Static Frontend ─────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install system deps for cryptography wheels
RUN apt-get update && apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend into backend/static for serving
COPY --from=frontend-build /build/frontend/build ./backend/static

# Railway injects PORT env var
ENV PORT=8001

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn backend.server:app --host 0.0.0.0 --port ${PORT}"]
