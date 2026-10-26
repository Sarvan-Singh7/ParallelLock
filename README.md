# ParallelLock

A movie-ticket booking system built for a university backend viva.

> Full README is written in M8. This file is a placeholder stub.

## Quick start (dev)

```bash
# 1. Start Postgres
docker compose up -d

# 2. Configure env
cp server/.env.example server/.env   # edit JWT_SECRET

# 3. Migrate & seed
cd server
npm install
npm run migrate
npm run seed

# 4. Run the server
npm run dev
```

**Stack:** Node 22, Express, PostgreSQL 16 (pg driver, raw SQL), zod, jsonwebtoken, argon2, Vitest + supertest.  
Logging: `console.error` for unexpected 5xx only (structured logging planned for phase 5).

API listens on http://localhost:4000  
Client (added in M5) on http://localhost:5173
