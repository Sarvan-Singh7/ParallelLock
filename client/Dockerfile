# ==============================================================================
# ParallelLock Frontend Client – Multi-Stage Dockerfile (SPA with Nginx)
# ==============================================================================

# ── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build-time API URL argument
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: Serve with Nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Copy built static assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx SPA rewrite configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
