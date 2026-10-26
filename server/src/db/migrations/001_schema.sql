-- 001_schema.sql
-- ParallelLock: 8 tables for movie ticket booking with strict row-locking guarantees

-- 1. Users
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Theaters
CREATE TABLE theaters (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL,
  city       TEXT NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Kolkata'
);

-- 3. Screens
CREATE TABLE screens (
  id         BIGSERIAL PRIMARY KEY,
  theater_id BIGINT NOT NULL REFERENCES theaters(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  format     TEXT NOT NULL  -- e.g. '2D', 'LASER', 'IMAX'
);

-- 4. Seats
CREATE TABLE seats (
  id          BIGSERIAL PRIMARY KEY,
  screen_id   BIGINT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  row_label   TEXT NOT NULL,
  seat_label  TEXT NOT NULL,
  section     TEXT NOT NULL CHECK (section IN ('GOLD', 'SILVER')),
  grid_row    INT NOT NULL,
  grid_col    INT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT uq_seats_screen_row_seat UNIQUE (screen_id, row_label, seat_label),
  CONSTRAINT uq_seats_screen_grid UNIQUE (screen_id, grid_row, grid_col)
);

-- 5. Movies
CREATE TABLE movies (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  synopsis     TEXT NOT NULL,
  duration_min INT NOT NULL,
  certificate  TEXT NOT NULL,
  languages    TEXT[] NOT NULL,
  genres       TEXT[] NOT NULL,
  poster_url   TEXT DEFAULT NULL,
  release_date DATE NOT NULL
);

-- 6. Shows
CREATE TABLE shows (
  id        BIGSERIAL PRIMARY KEY,
  movie_id  BIGINT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  screen_id BIGINT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  language  TEXT NOT NULL,
  format    TEXT NOT NULL
);
CREATE INDEX idx_shows_movie_starts_at ON shows(movie_id, starts_at);

-- 7. Bookings
CREATE TABLE bookings (
  id              BIGSERIAL PRIMARY KEY,
  ref             TEXT UNIQUE NOT NULL,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  show_id         BIGINT NOT NULL REFERENCES shows(id),
  status          TEXT NOT NULL CHECK (status IN ('CREATED', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  seat_ids        BIGINT[] NOT NULL,
  total_cents     INT NOT NULL,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  paid_at         TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial unique index ensures at most one active hold per user per show
CREATE UNIQUE INDEX uq_bookings_active_user_show ON bookings(user_id, show_id) WHERE status = 'CREATED';
CREATE INDEX idx_bookings_user_created ON bookings(user_id, created_at DESC);

-- 8. Show Seats (inventory per show)
-- Blocked seats (is_active=false) get NO show_seats row, so they can never be booked.
CREATE TABLE show_seats (
  show_id         BIGINT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_id         BIGINT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  price_cents     INT NOT NULL,
  booking_id      BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
  hold_expires_at TIMESTAMPTZ DEFAULT NULL,
  PRIMARY KEY (show_id, seat_id),
  CONSTRAINT chk_show_seats_status_consistency CHECK (
    (status = 'AVAILABLE' AND booking_id IS NULL AND hold_expires_at IS NULL) OR
    (status = 'HELD'      AND booking_id IS NOT NULL AND hold_expires_at IS NOT NULL) OR
    (status = 'BOOKED'    AND booking_id IS NOT NULL)
  )
);
CREATE INDEX idx_show_seats_show_status ON show_seats(show_id, status);
