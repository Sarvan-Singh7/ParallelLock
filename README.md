# ParallelLock 🎟️🔒

A high-concurrency movie ticket booking engine built with **Node.js**, **Express**, **PostgreSQL**, and **React**. Designed specifically to eliminate overselling, race conditions, and deadlocks under heavy concurrent load using strict row-level locking (`SELECT ... FOR UPDATE`), deterministic lock sorting, and transactional isolation.

---

## 📌 Table of Contents

- [Overview & Problem Statement](#-overview--problem-statement)
- [Core Concurrency Guarantees](#-core-concurrency-guarantees)
  - [1. Row-Level Locking (`SELECT ... FOR UPDATE`)](#1-row-level-locking-select--for-update)
  - [2. Deadlock Prevention via Sorted Acquisition](#2-deadlock-prevention-via-sorted-acquisition)
  - [3. Transaction Timeouts & Fail-Fast Protection](#3-transaction-timeouts--fail-fast-protection)
  - [4. Two-Phase Reservation Lifecycle (Holds vs. Bookings)](#4-two-phase-reservation-lifecycle-holds-vs-bookings)
  - [5. Decoupled Payment Flow (Zero DB Locks During External I/O)](#5-decoupled-payment-flow-zero-db-locks-during-external-io)
  - [6. Database-Level Invariants & Partial Indexes](#6-database-level-invariants--partial-indexes)
- [System Architecture & Stack](#-system-architecture--stack)
- [Database Schema (8 Tables)](#-database-schema-8-tables)
- [API Reference](#-api-reference)
- [Concurrency Verification & Demos](#-concurrency-verification--demos)
  - [Live Race Condition Demonstration (`demo:parallel`)](#live-race-condition-demonstration-demoparallel)
  - [Lock-Free Failure Simulation (`demo:unsafe`)](#lock-free-failure-simulation-demounsafe)
  - [Automated Stress & Deadlock Test Suites](#automated-stress--deadlock-test-suites)
- [Project Structure](#-project-structure)
- [Quick Start Guide](#-quick-start-guide)
  - [Prerequisites](#prerequisites)
  - [1. Start Database (Docker)](#1-start-database-docker)
  - [2. Configure Server Environment](#2-configure-server-environment)
  - [3. Run Migrations & Seed Data](#3-run-migrations--seed-data)
  - [4. Start the API Server](#4-start-the-api-server)
  - [5. Start the React Client](#5-start-the-react-client)
  - [Default Seed Accounts](#default-seed-accounts)
- [Environment Variables](#-environment-variables)
- [Viva & Technical Interview Q&A](#-viva--technical-interview-qa)

---

## 🚀 Overview & Problem Statement

In flash-sale and high-demand ticketing scenarios (e.g., concert tickets, blockbuster movie premiers), thousands of concurrent requests attempt to reserve the same finite inventory simultaneously.

Naive implementations commonly suffer from three fatal flaws:
1. **The "Check-Then-Act" Race Condition (Double-Booking / Overselling):** Two users inspect seat status simultaneously, both observe it as `AVAILABLE`, and both issue an `UPDATE`. Without transactional locking, both users receive confirmation for the identical seat.
2. **Deadlocks in Multi-Seat Selection:** User A attempts to reserve `[Seat 1, Seat 2]` while User B attempts to reserve `[Seat 2, Seat 1]`. When locks are acquired out-of-order, both transactions block each other indefinitely until the database engine terminates one with error `40P01 (deadlock_detected)`.
3. **Database Connection Exhaustion from Long Transactions:** Holding database connections open while awaiting third-party payment gateway HTTP calls quickly drains the database connection pool, taking down the entire API.

**ParallelLock** solves all three problems using pure PostgreSQL relational ACID primitives, zero heavy ORM overhead, and clean architectural separation.

---

## 🛡️ Core Concurrency Guarantees

### 1. Row-Level Locking (`SELECT ... FOR UPDATE`)
When a user requests to hold seats, the transaction executes:
```sql
SELECT
  seat_id,
  price_cents,
  (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now())) AS is_free
FROM show_seats
WHERE show_id = $1 AND seat_id = ANY($2::bigint[])
ORDER BY seat_id ASC
FOR UPDATE;
```
`FOR UPDATE` locks the specific matching rows in `show_seats` exclusively. Any competing transaction attempting to hold or book those same seats blocks until the first transaction commits or rolls back. Once released, subsequent transactions immediately see the updated status (`HELD` or `BOOKED`) and fail fast with `409 SEAT_UNAVAILABLE`.

### 2. Deadlock Prevention via Sorted Acquisition
Deadlocks happen when locks on multiple resources are acquired in inconsistent order. 
ParallelLock guarantees that all multi-seat locks are acquired in **strictly ascending numerical order** (`ORDER BY seat_id ASC`).

```
User A [Seat 5, Seat 2]  ──► Sorted to [Seat 2, Seat 5] ──► Locks Seat 2 first, then Seat 5
User B [Seat 2, Seat 5]  ──► Sorted to [Seat 2, Seat 5] ──► Queues behind User A on Seat 2
```
Because transactions always acquire resources in the exact same global order, circular wait dependency is mathematically impossible. Verified via 300 iterations of reverse-order stress tests with 0 deadlocks.

### 3. Transaction Timeouts & Fail-Fast Protection
To prevent slow network clients or stalled transactions from blocking PostgreSQL worker threads, every transactional operation sets tight session-scoped timeouts:
```sql
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';
```
If a query cannot obtain a lock within 2 seconds, PostgreSQL cancels the lock attempt immediately and returns `503 SERVICE_UNAVAILABLE`, preventing connection pool starvation.

### 4. Two-Phase Reservation Lifecycle (Holds vs. Bookings)
ParallelLock implements a standard two-phase reservation pattern:

```
[ AVAILABLE ]
     │
     ▼ (POST /api/v1/shows/:id/holds)
  [ HELD ] ──(8-Minute Timer Expires / User Cancels)──► [ AVAILABLE ]
     │
     ▼ (POST /api/v1/bookings/:id/pay)
 [ BOOKED ]
```

- **Hold Phase:** Seats are transitioned from `AVAILABLE` to `HELD` with an expiration timestamp (`now() + 8 minutes`).
- **Active Hold Single-Booking Invariant:** A user can only hold **one** active reservation per show at any time.
- **Lazy Expiration (Cron-Free):** Rather than running background polling jobs every second, expired holds are automatically treated as `is_free = true` during subsequent queries and cleaned up lazily when users attempt a new hold or check seat status.

### 5. Decoupled Payment Flow (Zero DB Locks During External I/O)
Holding database locks across external network boundaries is an anti-pattern. ParallelLock executes payment outside the transaction:
1. **Pre-Payment Read:** Validates booking ownership, ensures status is `CREATED`, and verifies the hold has not expired.
2. **External Gateway Call:** Executes payment strategy (`mockStrategy` / payment provider) **outside** the database transaction.
3. **Atomic Finalization:** Acquires a lock on the booking, re-verifies expiry, updates `show_seats` to `BOOKED`, and marks the booking `CONFIRMED`.

### 6. Database-Level Invariants & Partial Indexes
- **Single Active Hold per User:**
  ```sql
  CREATE UNIQUE INDEX uq_bookings_active_user_show 
    ON bookings(user_id, show_id) 
    WHERE status = 'CREATED';
  ```
- **Show Seat Status Consistency Check:**
  ```sql
  CONSTRAINT chk_show_seats_status_consistency CHECK (
    (status = 'AVAILABLE' AND booking_id IS NULL AND hold_expires_at IS NULL) OR
    (status = 'HELD'      AND booking_id IS NOT NULL AND hold_expires_at IS NOT NULL) OR
    (status = 'BOOKED'    AND booking_id IS NOT NULL)
  )
  ```

---

## 💻 System Architecture & Stack

```
┌────────────────────────────────────────────────────────┐
│                  React 18 Client (Vite)                │
│  - Interactive SVG/Grid Seat Map                       │
│  - Real-time Status Polling (5s cadence)               │
│  - Hold Countdown Timer & Checkout Flow                │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / REST (JSON)
┌───────────────────────────▼────────────────────────────┐
│                  Node.js / Express API                 │
│  - Layered Architecture (Routes ➔ Controller ➔ Service)│
│  - Raw SQL Repositories (`pg` Pool)                    │
│  - Zod Request Validation & Argon2 Password Hashing    │
│  - JWT Bearer Authentication                           │
└───────────────────────────┬────────────────────────────┘
                            │ Raw SQL (Parameterised)
┌───────────────────────────▼────────────────────────────┐
│                 PostgreSQL 16 Engine                   │
│  - `SELECT ... FOR UPDATE` Row Locks                   │
│  - Ascending Order Multi-Row Locking                   │
│  - Partial Unique Indexes & CHECK Constraints          │
└────────────────────────────────────────────────────────┘
```

| Layer | Technology | Key Details |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (>=20, ESM) | Native `--env-file`, native ESM modules |
| **Web Framework** | Express.js 4.19 | RESTful API, centralized error handling |
| **Database** | PostgreSQL 16 Alpine | Managed via Docker Compose on port `5433` |
| **Database Client** | `pg` (node-postgres) | Direct connection pool, raw SQL queries (no ORM hiding lock behavior) |
| **Validation** | Zod 3.23 | Strict request body schema validation |
| **Security** | Argon2 + JSONWebToken | Industry-standard password hashing & stateless auth |
| **Frontend** | React 18 + Vite 5 | React Router 6, CSS Modules, print stylesheet for tickets |
| **Testing** | Vitest 2.0 + Supertest 7 | Integration tests, parallel hold stress tests, deadlock suites |

---

## 🗄️ Database Schema (8 Tables)

```mermaid
erDiagram
    THEATERS ||--o{ SCREENS : contains
    SCREENS ||--o{ SEATS : has
    SCREENS ||--o{ SHOWS : hosts
    MOVIES ||--o{ SHOWS : features
    USERS ||--o{ BOOKINGS : places
    SHOWS ||--o{ BOOKINGS : reserves
    SHOWS ||--o{ SHOW_SEATS : allocates
    SEATS ||--o{ SHOW_SEATS : maps_to
    BOOKINGS ||--o{ SHOW_SEATS : holds

    THEATERS {
        bigserial id PK
        text name
        text address
        text city
        text timezone
    }

    SCREENS {
        bigserial id PK
        bigint theater_id FK
        text name
        text format
    }

    SEATS {
        bigserial id PK
        bigint screen_id FK
        text row_label
        text seat_label
        text section
        int grid_row
        int grid_col
        boolean is_active
    }

    MOVIES {
        bigserial id PK
        text title
        text synopsis
        int duration_min
        text certificate
        text[] languages
        text[] genres
        text poster_url
        date release_date
    }

    SHOWS {
        bigserial id PK
        bigint movie_id FK
        bigint screen_id FK
        timestamptz starts_at
        text language
        text format
    }

    USERS {
        bigserial id PK
        text name
        text email UK
        text password_hash
        timestamptz created_at
    }

    BOOKINGS {
        bigserial id PK
        text ref UK
        bigint user_id FK
        bigint show_id FK
        text status
        bigint[] seat_ids
        int total_cents
        timestamptz hold_expires_at
        timestamptz paid_at
        timestamptz created_at
    }

    SHOW_SEATS {
        bigint show_id PK, FK
        bigint seat_id PK, FK
        text status
        int price_cents
        bigint booking_id FK
        timestamptz hold_expires_at
    }
```

---

## 🔌 API Reference

Base URL: `http://localhost:4000/api/v1`

### 1. Authentication
| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/auth/register` | No | Register new user account (`name`, `email`, `password`) |
| `POST` | `/auth/login` | No | Login and obtain JWT token (`email`, `password`) |

### 2. Movies & Catalog
| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/movies` | No | List all active movies with genres, certificate, duration |
| `GET` | `/movies/:id/shows` | No | Retrieve scheduled upcoming shows for a movie grouped by theater |

### 3. Seats & Layout
| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/shows/:id/seats` | Optional | Retrieve full seat layout with pricing and real-time status (`AVAILABLE`, `MINE`, `UNAVAILABLE`, `BLOCKED`) |

### 4. Holds & Bookings
| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/shows/:id/holds` | **Yes** | Acquire transactional lock and hold seats for 8 minutes (`{ seatIds: [1, 2] }`) |
| `GET` | `/bookings/:id` | **Yes** | Get booking receipt, ticket details, and hold countdown timer |
| `POST` | `/bookings/:id/pay` | **Yes** | Confirm booking and execute payment (`{ method: "CARD" \| "UPI" \| "NETBANKING" }`) |
| `DELETE`| `/bookings/:id` | **Yes** | Release active hold and immediately return seats back to `AVAILABLE` |
| `GET` | `/me/bookings` | **Yes** | Retrieve user's booking history (up to 50 entries) |

### 5. Diagnostics
| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | Health check endpoint returning `{ "status": "ok" }` |

---

## 🧪 Concurrency Verification & Demos

### Live Race Condition Demonstration (`demo:parallel`)
Simulates $N$ users firing parallel hold requests at the exact same millisecond for the identical seat.

```bash
cd server
npm run demo:parallel
# Or specify parameters: node --env-file=.env scripts/demoParallel.js [showId] [seatId] [N]
```

**Expected Output:**
```
🚀  Firing 20 parallel hold requests for seat 1 on show 1...
Target: http://localhost:4000/api/v1/shows/1/holds

=== Parallel Hold Results ===
Total parallel attempts: 20
201 CREATED (Holds won): 1
409 SEAT_UNAVAILABLE:   19
Other responses:         0

=== Database Verification ===
show_seats status: HELD
holding booking_id: 3
✅  Row-level lock succeeded: Exactly 1 caller acquired the hold.
```

### Lock-Free Failure Simulation (`demo:unsafe`)
Simulates what happens when row locks (`FOR UPDATE`) are omitted (check-then-act anti-pattern):

```bash
cd server
npm run demo:unsafe
```

**Output:**
```
⚠️  Simulating LOCK-FREE race condition with 10 parallel workers on seat 1...

Worker 1: Read seat 1 as AVAILABLE
Worker 2: Read seat 1 as AVAILABLE
Worker 3: Read seat 1 as AVAILABLE
...
Worker 1: Wrote HELD!
Worker 2: OVERWROTE HELD! (Race condition reproduced)
❌  Race condition occurred: 10 workers overrode each other!
```

### Automated Stress & Deadlock Test Suites

Run the complete Vitest integration test suite:

```bash
cd server
npm test
```

Run dedicated concurrency stress test suites:

```bash
npm run test:concurrency
```

1. **`parallelHold.test.js`:**
   - 100 concurrent requests against a single seat.
   - 500 concurrent requests against a single seat.
   - **Guarantees:** Exactly one `201 Created`, all remaining `409 SEAT_UNAVAILABLE`, zero `5xx` errors, exactly 1 `HELD` row in PostgreSQL.
2. **`oppositeOrder.test.js`:**
   - 300 iterations of User 1 booking `[s1, s2]` while User 2 bookings `[s2, s1]` simultaneously.
   - **Guarantees:** Zero deadlocks (`40P01`), zero `500` errors, exactly one winner per iteration.
3. **`expiry.test.js`:**
   - Verifies automatic seat reclamation after hold expiration without cron dependencies.

---

## 📂 Project Structure

```
ParallelLock_Project/
├── docs/
│   └── design/
│       └── Design_Figma.pdf          # UI/UX design mockups & prototypes
└── parallellock/
    ├── docker-compose.yml            # PostgreSQL 16 Alpine container configuration
    ├── README.md                     # Project documentation (this file)
    │
    ├── client/                       # React 18 Frontend
    │   ├── index.html
    │   ├── vite.config.js
    │   └── src/
    │       ├── components/           # Header, ProtectedRoute, SeatCountModal, ErrorBanner
    │       ├── context/              # AuthContext (JWT management & session state)
    │       ├── features/
    │       │   ├── auth/             # LoginPage, RegisterPage
    │       │   ├── home/             # HomePage, MovieCard, ShowPill
    │       │   ├── seats/            # SeatPage, SeatGrid, Seat, Legend, seatReducer
    │       │   ├── checkout/         # CheckoutPage, TicketCard
    │       │   └── bookings/         # MyBookingsPage
    │       ├── hooks/                # useFetch, usePolling
    │       └── styles/               # global.css, variables.css, print.css
    │
    └── server/                       # Node.js + Express Backend
        ├── package.json
        ├── .env.example
        ├── scripts/
        │   ├── demoParallel.js       # Concurrency hold test (shows 1 win, N-1 rejections)
        │   └── demoUnsafe.js         # Demonstrates check-then-act vulnerability
        ├── tests/
        │   ├── helpers/              # Test DB helpers, token minters
        │   ├── integration/          # auth.test.js, booking.test.js, expiry.test.js
        │   └── concurrency/          # parallelHold.test.js, oppositeOrder.test.js
        └── src/
            ├── server.js             # HTTP server entrypoint
            ├── app.js                # Express app setup, routing & middleware
            ├── config/               # env.js (Environment variables & defaults)
            ├── common/               # Custom errors, validation, token utils, middleware
            ├── db/
            │   ├── pool.js           # pg Pool instance
            │   ├── tx.js             # Transaction helper with auto-rollback
            │   ├── migrate.js        # SQL migration runner
            │   ├── migrations/       # 001_schema.sql (8 tables, constraints, indexes)
            │   └── seeds/seed.js     # Deterministic dev seed data
            └── modules/
                ├── auth/             # Authentication & user registration
                ├── catalog/          # Movie & showtime listings
                ├── seats/            # Seat maps & availability calculation
                ├── booking/          # Core hold logic, payment finalization, release
                └── payment/          # Payment service & strategy pattern
```

---

## ⚡ Quick Start Guide

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [Docker](https://www.docker.com/) & Docker Compose
- `npm` `>= 10.0.0`

### 1. Start Database (Docker)
Start the PostgreSQL container (mapped to host port **5433** to avoid collisions with any local PostgreSQL instance):

```bash
cd parallellock
docker compose up -d
```

Verify the container is healthy:
```bash
docker compose ps
```

### 2. Configure Server Environment
Create the `.env` file from `.env.example`:

```bash
cd server
cp .env.example .env
```

Ensure `server/.env` contains:
```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/parallellock
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/parallellock_test
JWT_SECRET=super_secret_jwt_key_at_least_32_characters_long_12345
PORT=4000
HOLD_SECONDS=480
CLIENT_ORIGIN=http://localhost:5173
MOCK_PAYMENT_FAIL=false
```

### 3. Run Migrations & Seed Data
Initialize the schema and seed demo movies, theaters, screens, and shows:

```bash
# Inside parallellock/server
npm install
npm run migrate
npm run seed
```

### 4. Start the API Server
```bash
npm run dev
```
The server will start on [http://localhost:4000](http://localhost:4000). Test the health check:
```bash
curl http://localhost:4000/health
# Output: {"status":"ok"}
```

### 5. Start the React Client
Open a second terminal window:

```bash
cd parallellock/client
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Default Seed Accounts

The seed script creates two pre-configured accounts:

| Name | Email | Password |
| :--- | :--- | :--- |
| **Alice Smith** | `alice@example.com` | `Password123` |
| **Bob Jones** | `bob@example.com` | `Password123` |

You can also register any new user directly through the frontend UI or via `POST /api/v1/auth/register`.

---

## ⚙️ Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://...:5433/parallellock` | Primary PostgreSQL connection string |
| `TEST_DATABASE_URL` | `postgresql://...:5433/parallellock_test` | Isolated database for integration & concurrency tests |
| `JWT_SECRET` | *Must be >= 32 chars* | Symmetric secret key for signing user auth tokens |
| `PORT` | `4000` | HTTP port for the Express application |
| `HOLD_SECONDS` | `480` | Duration (in seconds) of a seat hold (default: 8 minutes) |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for the Vite client |
| `MOCK_PAYMENT_FAIL` | `false` | When set to `true`, simulates a 402 payment gateway failure |

---

## 🎓 Viva & Technical Interview Q&A

### Q1: Why use raw SQL with `pg` instead of an ORM like Prisma or TypeORM?
> **Answer:** Concurrency-critical systems require precise control over when database locks are acquired, in what order, and when transactions begin and commit. ORMs often abstract query generation, issue hidden queries, or buffer operations, making it easy to accidentally introduce lock inversions or hold connections longer than necessary. Raw parameterized SQL ensures that `FOR UPDATE`, `ORDER BY seat_id ASC`, and session-level timeouts execute predictably.

### Q2: How does ParallelLock guarantee zero deadlocks when multiple seats are booked?
> **Answer:** Deadlocks occur when two transactions acquire locks in opposing order (e.g. Transaction 1 locks Seat A then waits for Seat B; Transaction 2 locks Seat B then waits for Seat A). ParallelLock sorts requested `seatIds` numerically in ascending order before executing `SELECT ... FOR UPDATE`. All concurrent transactions acquire row locks in the exact same sequence, eliminating cyclic lock dependencies.

### Q3: Why is payment processing performed outside the database transaction?
> **Answer:** External payment gateways involve network latency (typically 500ms to 3s). If an external API call is made inside an open database transaction, the row locks on `show_seats` remain held for the entire round-trip. This severely throttles database throughput and exhausts connection pools. ParallelLock validates the hold first, calls the payment gateway *outside* the transaction, and finalizes the reservation in a separate rapid transaction.

### Q4: How are expired holds handled without a background cron job?
> **Answer:** ParallelLock uses lazy expiration evaluation. The query checking seat availability evaluates:
> ```sql
> (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now())) AS is_free
> ```
> If a hold's TTL has expired, any subsequent user can immediately acquire the lock and overwrite the hold. Additionally, when a user initiates a new hold, their previous stale holds for that show are marked expired. This avoids unnecessary background cron polling overhead.

### Q5: Why is PostgreSQL exposed on port 5433 in `docker-compose.yml`?
> **Answer:** Standard PostgreSQL installations run on port 5432. Mapping the container to port 5433 avoids port collisions on machines with an existing local PostgreSQL service running.

---

## 📄 License
This project is open-source and intended for academic demonstration, architectural study, and university viva evaluation.
