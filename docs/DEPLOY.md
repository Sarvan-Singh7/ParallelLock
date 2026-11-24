# Deployment Guide – ParallelLock

This document covers operational procedures for deploying ParallelLock to production (e.g. Render, Railway, AWS ECS/EKS, Kubernetes, or Docker Compose).

---

## 1. Environment Variables

All production environment variables must be configured securely before booting the server:

| Variable | Required | Description | Example / Recommended Value |
|---|:---:|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string | `postgresql://user:pass@ep-xyz.region.aws.neon.tech/parallellock?sslmode=require` |
| `JWT_SECRET` | **Yes** | Token signing key (**≥ 32 chars**, non-default) | Cryptographically secure hex (`crypto.randomBytes(32).toString('hex')`) |
| `WEBHOOK_SECRET` | **Yes** | Payment webhook HMAC secret (≥ 16 chars) | Cryptographically secure string |
| `CLIENT_ORIGIN` | **Yes** | Whitelisted frontend origin for CORS | `https://tickets.example.com` |
| `HOLD_SECONDS` | No | Seat reservation hold window in seconds | `480` (8 minutes) |
| `PORT` | No | HTTP listening port (defaults to 4000) | `4000` (or platform `$PORT`) |
| `NODE_ENV` | **Yes** | Runtime environment | `production` |
| `TRUST_PROXY` | If Proxied | Upstream reverse proxy hop count | `1` (behind Cloudflare/Render/ALB) |
| `ENABLE_RATE_LIMITER` | No | Sliding-window rate limiter toggle | `true` (default in production) |
| `SWEEPER_INTERVAL_MS` | No | Advisory sweeper polling cadence | `30000` (30 seconds) |

> [!CAUTION]
> **Production Secret Check:** When `NODE_ENV=production`, the server evaluates all secrets during startup. If `JWT_SECRET` is shorter than 32 characters or matches known development/example placeholders, the process immediately halts with exit code 1 to prevent insecure deployments.

---

## 2. Running Migrations on Deploy

ParallelLock uses an idempotent, transactional migration runner (`server/src/db/migrate.js`).

### Pre-Deploy Command (Render / Railway / Kubernetes Init Container)
Execute the migration command prior to releasing traffic to new application instances:
```bash
npm run db:migrate
```

### Key Guarantees:
1. **Idempotent:** Migrations track applied files in the `schema_migrations` table (`filename PRIMARY KEY`). Already-applied files are safely skipped (`skip 001_schema.sql`).
2. **Transactional:** Every individual migration file executes inside an isolated `BEGIN ... COMMIT` block. If an error occurs, the file is rolled back with `ROLLBACK` without leaving partial schema changes.
3. **Fail-Fast:** Any failure causes the runner to log the exact error and terminate with a non-zero exit code (`process.exit(1)`), halting automated CD pipelines before broken application instances can start.

---

## 3. Zero-Downtime Rolling Deployments

During a rolling deployment, multiple application container instances running old and new versions may execute concurrently.

### A. Passive Expiry Works Without Coordination
- In naive booking engines, background workers must poll every second to release expired holds.
- In ParallelLock, **all seat availability checks evaluate against the database clock (`now()`)**:
  ```sql
  (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))
  ```
- Because expiration is checked inline on the database clock during user queries, seats expire deterministically and safely across rolling instances without requiring lock synchronization or downtime.

### B. Advisory Lock Prevents Sweeper Collisions
- Even if multiple server instances run concurrently during a rolling deploy, the background sweeper uses **PostgreSQL session advisory locks**:
  ```sql
  SELECT pg_try_advisory_lock(987654321);
  ```
- Executed on a **dedicated PostgreSQL client** checked out exclusively for the sweep duration.
- Only one instance can hold the lock at any given moment. All other instances skip the sweep cycle immediately without queuing or blocking.
- When an old container terminates, `pg_advisory_unlock` is executed in a `finally` block, and connection close releases any residual advisory lock automatically.

---

## 4. Health & Readiness Verification

ParallelLock exposes two dedicated endpoints for orchestrator probes:

### Liveness Probe (`GET /health`)
- Verifies that the Node.js event loop and HTTP server are responsive.
- Does not query external dependencies (avoids cascading restarts during transient database blips).
- **HTTP 200 OK Response:**
  ```json
  {
    "status": "ok",
    "uptime": 124,
    "timestamp": "2026-11-24T10:30:00.000Z"
  }
  ```

### Readiness Probe (`GET /ready`)
- Verifies active database connectivity by executing `SELECT 1`.
- Orchestrators (e.g. Kubernetes, AWS ALB, Render) use this probe to determine when a container is ready to accept user traffic.
- **HTTP 200 OK Response (Healthy):**
  ```json
  {
    "status": "ready",
    "db": "connected",
    "timestamp": "2026-11-24T10:30:00.000Z"
  }
  ```
- **HTTP 503 Service Unavailable (Unhealthy / Disconnected):**
  ```json
  {
    "status": "not_ready",
    "db": "disconnected",
    "error": "connection refused",
    "timestamp": "2026-11-24T10:30:00.000Z"
  }
  ```

---

## 5. Client SPA Static Hosting & Rewrites

The React single-page application uses client-side routing (`react-router-dom`).

1. **Build Step:**
   ```bash
   cd client
   VITE_API_URL=https://api.yourdomain.com/api/v1 npm run build
   ```
2. **Path Rewrites:**
   - **Nginx (`client/nginx.conf`):** `try_files $uri $uri/ /index.html;` ensures refreshing on `/shows/1` or `/checkout/10` does not return 404.
   - **Render / Netlify (`client/public/_redirects`):** `/* /index.html 200` automatically rewrites all deep routes to `index.html`.
