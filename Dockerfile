# ==============================================================================
# ParallelLock (Root) – Multi-Stage Production Dockerfile
# ==============================================================================
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node server/package*.json ./
COPY --chown=node:node server/src ./src

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
