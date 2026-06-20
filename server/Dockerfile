# YouTopia Intelligent Music Server — Dockerfile
#
# Multi-stage build: compile TypeScript in a build stage, run from a minimal
# runtime stage.  Uses host networking in production so the server can reach
# LAN services (WLED @ 10.27.27.110, Ollama @ 10.27.27.10:11434).
#
# Build:
#   docker build -t youtopia-server:latest .
#
# Run (development / local):
#   docker run --network=host \
#     -e YOUTOPIA_JWT_SECRET=your-secret \
#     youtopia-server:latest
#
# Run with config file:
#   docker run --network=host \
#     -v /opt/youtopia-config/youtopia-server.json:/app/youtopia-server.json:ro \
#     -v /opt/youtopia-data:/app/data \
#     youtopia-server:latest

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package files and install all deps (including devDeps for tsc)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune devDeps for the runtime image
RUN npm prune --omit=dev

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# ffmpeg needed by DSP layer (Pod C) and audio capture (Pod B)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r youtopia && useradd -r -g youtopia -d /app -s /sbin/nologin youtopia

WORKDIR /app

# Copy compiled output + production node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create data directory (SQLite / cache)
RUN mkdir -p /app/data && chown -R youtopia:youtopia /app

USER youtopia

# Expose port (override with YOUTOPIA_PORT env var if needed)
EXPOSE 9870

# Environment defaults — override at runtime
ENV YOUTOPIA_PORT=9870 \
    YOUTOPIA_HOST=0.0.0.0 \
    YOUTOPIA_DATA_DIR=/app/data \
    YOUTOPIA_AI_PROVIDER=ollama \
    YOUTOPIA_OLLAMA_URL=http://10.27.27.10:11434 \
    YOUTOPIA_OLLAMA_MODEL=kimi-k2.7-code:cloud \
    YOUTOPIA_WLED_HOST=10.27.27.110 \
    NODE_ENV=production \
    LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9870/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
