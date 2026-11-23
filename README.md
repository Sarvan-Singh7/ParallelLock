# ParallelLock

A production-grade, high-concurrency movie ticket booking engine built with **Node.js**, **Express**, **PostgreSQL**, and **React**.

ParallelLock demonstrates how to solve the classic **"check-then-act" race condition**, double-booking anomalies, and distributed deadlocks in high-demand seat reservation systems using **PostgreSQL row-level locks** (`SELECT ... FOR UPDATE`) and transactional isolation—without external cache layers or distributed lock managers.

---

## ⚡ What It Solves

When thousands of users contend for the exact same high-demand seats at the exact same millisecond (e.g., blockbuster ticket drops, concert releases):
1. **Zero Double-Booking:** Strict row-level locking (`SELECT ... FOR UPDATE`) on physical seat records guarantees that exactly one transaction holds a seat. All concurrent competing transactions fail fast with `409 Conflict`.
2. **Deterministic Deadlock Prevention:** Multi-seat bookings sort seat IDs in strictly ascending numerical order (`ORDER BY seat_id ASC`) prior to acquisition, eliminating cyclic wait graphs across concurrent transactions.
3. **Fail-Fast Connection Protection:** Configured `lock_timeout = '2s'` and `statement_timeout = '5s'` abort stalled transactions before they can saturate the database connection pool.
4. **Passive Two-Phase Lifecycle:** Seats transition through `AVAILABLE` ➔ `HELD` (configurable reservation window, default 8 minutes) ➔ `BOOKED` (upon payment confirmation). Expired holds are reclaimed passively during subsequent queries on the database clock (`now()`), eliminating dependency on background sweeper crons.
5. **Decoupled Payment Execution:** Payment processing runs outside database transactions, preventing slow third-party payment gateways from holding database locks.

---

## 🏗️ Architecture: Built vs. Planned

| Layer / Feature | Status | Details |
|---|:---:|---|
| **PostgreSQL Schema & Row Locks** | **Built** | `shows`, `seats`, `show_seats`, `bookings`, `users` with foreign keys and unique constraints |
| **Deterministic Seat Ordering** | **Built** | `SELECT ... FOR UPDATE` ordered by `seat_id ASC` |
| **Fail-Fast Lock Timeouts** | **Built** | `lock_timeout = 2s`, `statement_timeout = 5s` per transaction |
| **Passive Expiry on DB Clock** | **Built** | Expiry evaluated against `now()` in SQL queries |
| **Auth & Security** | **Built** | Argon2id password hashing, JWT with HS256, CORS whitelist, Helmet headers |
| **Automated Concurrency Test Suite** | **Built** | 100 & 500 parallel user contention tests + 300 deadlock reversal tests |
| **React Interactive Booking Client** | **Built** | Movie catalog, auditorium layout, seat selection, 8-min countdown, checkout & tickets |
| **Idempotency Keys (`Idempotency-Key`)** | **Built** | Prevents duplicate holds on retry; returns `200` with `Idempotency-Replayed: true` |
| **Payment State Machine (`PAYMENT_PENDING`)** | **Built** | Two-phase commit with `payment_started_at`, 2-min lazy crash recovery, hold extension, and duplicate charge gating |
| **Payments, Webhooks & Refunds (P2-M3)** | **Built** | Three-phase payment (Phase A tx → Phase B external → Phase C tx), `payments` + `payment_events` tables, HMAC-SHA256 webhook verification, deduplication-in-one-tx, two-phase refund, `retryRefund`, `MOCK_PAYMENT_MODE=sync\|async`, `REFUND_PENDING`/`REFUNDED` states |
| **Admin Catalog Management** | *Planned (Phase 4)* | Admin UI and endpoints for creating movies and scheduling shows |
| **Redis / Distributed Cache** | *Future* | Read-through caching for movie catalog and read replicas |

---

## 🛠️ Prerequisites

- **Node.js:** `>= 20.0.0` (uses native ESM and Node `--env-file`)
- **Docker & Docker Compose:** For running the isolated PostgreSQL 16 Alpine container
- **Git**

---

## 🚀 Exact Setup Commands

### 1. Start the PostgreSQL Container
From the repository root (`parallellock/`):
```bash
docker compose up -d
```
> **Note:** PostgreSQL is mapped to host port **`5433`** (internal `5432`) to prevent port collisions with any existing local PostgreSQL instances.

### 2. Configure Environment Variables
```bash
cd server
cp .env.example .env
```
Ensure `server/.env` contains:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/parallellock
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/parallellock_test
JWT_SECRET=super_secret_development_key_minimum_32_characters_long_12345
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
HOLD_SECONDS=480
WEBHOOK_SECRET=at_least_16_chars_random_string
MOCK_PAYMENT_MODE=sync
```

### 3. Run Migrations & Seed the Database
```bash
# Still in server directory
npm install
npm run migrate
npm run seed
```
> **Important:** Seed data generates showtimes relative to the current execution day (`today`, `today + 1`, `today + 2`). **Re-run `npm run seed` each day** so showtimes remain in the future for testing.

### 4. Start the Backend API Server
```bash
npm run dev
```
The API server will listen on `http://localhost:4000`.

### 5. Start the React Frontend
In a new terminal window:
```bash
cd parallellock/client
npm install
npm run dev
```
The client application will start at `http://localhost:5173`.

---

## 👤 Seed Accounts for Testing

The database comes pre-seeded with sample theaters, movies, shows, and two test users:

| Email | Password | Role |
|---|---|---|
| `alice@example.com` | `Password123` | Customer |
| `bob@example.com` | `Password123` | Customer |

---

## 🧪 How to Run Tests

Ensure PostgreSQL is running (`docker compose up -d`), then run the test suites from `parallellock/server`:

```bash
cd server

# Run the complete test suite (integration + concurrency)
npm test

# Run only the concurrency stress tests
npm run test:concurrency

# Run only the integration test suite
npm run test:integration
```

---

## ⏱️ 5-Minute Live Demo Script

Follow this script to demonstrate the concurrency guarantees live in an interview or demo:

### Demo 1: Two Browsers Competing for the Exact Same Seat
1. Open an incognito browser window and a regular browser window at `http://localhost:5173`.
2. In Window 1, log in as `alice@example.com` / `Password123`.
3. In Window 2, log in as `bob@example.com` / `Password123`.
4. Both navigate to the same movie showtime (e.g. *The Last Orbit*, 7:30 PM).
5. Both select the exact same seat (e.g., `F7`).
6. Click **Proceed** on both browsers at the exact same moment:
   - **Winner:** One user gets a `201 Created`, holds the seat, and is redirected to checkout with an 8-minute countdown timer.
   - **Loser:** The other user immediately receives a `409 Conflict` banner stating the seat was just taken, and their seat map refreshes to show `F7` as unavailable.

### Demo 2: 20 Parallel Requests for 1 Seat (`npm run demo:parallel`)
Demonstrate raw transactional concurrency at the CLI:
```bash
cd server
npm run demo:parallel
```
- **What happens:** Fires 20 concurrent HTTP requests across independent worker promises targeting the exact same show and seat ID.
- **Result:** Exactly **1 request wins** (`201 Created`), **19 requests fail fast** (`409 Conflict`), and a database assertion verifies exactly 1 held row exists.

### Demo 3: The Check-Then-Act Vulnerability (`npm run demo:unsafe`)
Demonstrate why row-level locking is required by running a simulation without locks:
```bash
cd server
npm run demo:unsafe
```
- **What happens:** Simulates the naive `SELECT status FROM seats WHERE ...` followed by `UPDATE seats SET status = 'HELD'`.
- **Result:** Multiple concurrent workers read the seat as available simultaneously and overwrite each other, causing double-booking anomalies.

### Demo 4: Automatic Passive Hold Expiry
1. In `server/.env`, set `HOLD_SECONDS=10` and restart the server.
2. In the browser, select a seat and proceed to checkout.
3. Watch the countdown timer reach `00:00`.
4. Refresh or attempt payment—the server rejects payment with `410 Hold Expired` on the database clock and returns the seat back to `AVAILABLE` for any other user to claim immediately.

---

## ⚠️ Known Limitations

1. **Single Node / Single Database:** Row-level locks (`FOR UPDATE`) operate within a single PostgreSQL database instance. Multi-region multi-master databases require distributed coordination or partitioned sharding.
2. **Transient DB Clock Offset:** Timeouts rely on PostgreSQL `now()`. If application servers have heavy clock drift relative to the database, minor countdown discrepancies can occur (mitigated by using `serverTime` offsets returned in the API responses).
3. **Seed Dates Relative to Today:** Seeded showtimes are created for today and upcoming days. Re-run `npm run seed` if testing on a new date.