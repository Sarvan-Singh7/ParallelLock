# ParallelLock

A high-concurrency movie ticket booking engine built with **Node.js**, **Express**, **PostgreSQL**, and **React**. Built to solve the classic "check-then-act" race condition and deadlocks in high-demand seat reservation systems using PostgreSQL row-level locks and transactional isolation.

---

## ⚡ What It Solves

When multiple users try to book the same seat at the exact same millisecond:
- **No Double-Booking:** Strict row-level locking (`SELECT ... FOR UPDATE`) guarantees only one user can hold a seat. All competing requests fail fast with `409 Conflict`.
- **No Deadlocks:** Seats in multi-seat reservations are always locked in ascending numerical order (`ORDER BY seat_id ASC`), preventing cyclic wait conditions across concurrent transactions.
- **Fail-Fast Protection:** Configured `lock_timeout = 2s` and `statement_timeout = 5s` prevent slow transactions from exhausting the database pool.
- **Two-Phase Booking Lifecycle:** Seats transition through `AVAILABLE` ➔ `HELD` (8-minute reservation window) ➔ `BOOKED` (upon payment confirmation).
- **Decoupled Payment Execution:** Payment processing executes outside database transactions to avoid holding row locks during external network latency.

---

## 🛠️ Tech Stack

- **Backend:** Node.js (>=20, ESM), Express.js, `pg` (node-postgres with connection pooling & parameterized SQL)
- **Database:** PostgreSQL 16 Alpine (via Docker Compose on port `5433`)
- **Authentication & Security:** JWT (JSON Web Tokens), Argon2 password hashing
- **Validation:** Zod schemas
- **Frontend:** React 18, Vite, React Router 6, CSS Modules
- **Testing & Tooling:** Vitest, Supertest, Docker

---

## ✨ Features Implemented

### Backend (API)
- **Authentication:** User registration and login with Argon2 password hashing and JWT issuance.
- **Movie Catalog:** Endpoints to list movies, details, and schedules grouped by theater and screen format.
- **Real-Time Seat Map:** Returns seat coordinates, pricing tiers (Gold/Silver), and dynamic availability status (`AVAILABLE`, `MINE`, `UNAVAILABLE`, `BLOCKED`).
- **Transactional Holds:** Atomically places an 8-minute hold on selected seats with single-active-hold enforcement per user.
- **Checkout & Payment:** Payment confirmation endpoint that finalizes held seats to booked status.
- **Hold Release:** Cancellation endpoint that instantly returns held seats back to the available inventory pool.
- **User Bookings:** Endpoint to retrieve personal booking history with ticket details.

### Frontend (Client)
- **Movie Browsing:** Movie listing with genre tags, duration, certificates, and showtime selectors.
- **Interactive Seat Layout:** Visual grid displaying screen orientation, aisles, active seats, and pricing tiers.
- **Live Seat State Sync:** Client polls seat status every 5 seconds to reflect real-time holds by other users.
- **Seat Limit Selector:** Modal to choose seat quantity (1–10 seats) before selection.
- **Hold Countdown Timer:** Visual 8-minute countdown on checkout with auto-expiration warning.
- **Checkout Flow:** Payment method selection (Card, UPI, Netbanking) with ticket card preview and printable receipt view.
- **My Bookings Dashboard:** View past tickets and active holds.

---

## 🔌 API Endpoints

Base path: `/api/v1`

| Method | Endpoint | Auth | Description |
|---|---|:---:|---|
| `POST` | `/auth/register` | No | Register new user account |
| `POST` | `/auth/login` | No | Authenticate user & return JWT |
| `GET` | `/movies` | No | List all movies |
| `GET` | `/movies/:id/shows` | No | List upcoming shows for a movie |
| `GET` | `/shows/:id/seats` | Optional | Get seat layout and live status |
| `POST` | `/shows/:id/holds` | **Yes** | Place a transactional hold on seats |
| `GET` | `/bookings/:id` | **Yes** | Get booking and ticket details |
| `POST` | `/bookings/:id/pay` | **Yes** | Complete payment & confirm booking |
| `DELETE` | `/bookings/:id` | **Yes** | Release held seats back to pool |
| `GET` | `/me/bookings` | **Yes** | View authenticated user's booking history |
| `GET` | `/health` | No | Server health check probe |

---

## 🧪 Concurrency Demos & Tests

### 1. Parallel Hold Demo (`demo:parallel`)
Fires 20 concurrent requests for the exact same seat at the exact same time:
```bash
cd server
npm run demo:parallel
```
*Result:* Exactly 1 request wins (`201 Created`), 19 requests are rejected (`409 Conflict`), and database verifies exactly 1 held row.

### 2. Lock-Free Race Condition Demo (`demo:unsafe`)
Simulates the check-then-act vulnerability when row locks are disabled:
```bash
cd server
npm run demo:unsafe
```
*Result:* Multiple concurrent workers read the seat as available and overwrite each other, demonstrating why row-level locking is required.

### 3. Automated Concurrency Tests
Run the automated Vitest concurrency test suite:
```bash
cd server
npm run test:concurrency
```
- **`parallelHold.test.js`:** Fires 100 and 500 concurrent requests against a single seat to verify zero double-booking and zero 5xx server errors.
- **`oppositeOrder.test.js`:** Runs 300 iterations of two users attempting to lock seats in reverse order (`[s1, s2]` vs `[s2, s1]`) to prove zero deadlocks (`40P01`).

To run the full test suite (integration + concurrency):
```bash
npm test
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 20`
- Docker & Docker Compose

### 1. Start PostgreSQL
```bash
cd parallellock
docker compose up -d
```
*Note: PostgreSQL is exposed on port **5433** to avoid collisions with any local PostgreSQL instance.*

### 2. Setup the Server
```bash
cd server
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```
API server runs on `http://localhost:4000`.

### 3. Setup the Client
In a separate terminal:
```bash
cd parallellock/client
npm install
npm run dev
```
Client runs on `http://localhost:5173`.

---

## 👤 Seed Accounts

The database comes pre-seeded with sample theaters, movies, shows, and two test users:

| Email | Password |
|---|---|
| `alice@example.com` | `Password123` |
| `bob@example.com` | `Password123` |
