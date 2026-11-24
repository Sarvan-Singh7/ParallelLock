# ==============================================================================
# ParallelLock Backend Server – Multi-Stage Production Dockerfile
# ==============================================================================

# ── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Install build dependencies if needed (e.g. for argon2 native compilation)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Production Runner ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Run container as unprivileged non-root 'node' user for security
USER node

# Copy only production dependencies and runtime application files
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src

EXPOSE 4000

# Docker healthcheck against the GET /health liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
