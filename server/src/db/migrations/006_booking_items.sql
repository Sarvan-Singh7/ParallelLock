-- Migration: 006_booking_items.sql
-- Line-item tickets ledger (booking_items) and updated_at for bookings

-- 1. Add updated_at to bookings if not present
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. booking_items ledger
CREATE TABLE IF NOT EXISTS booking_items (
  booking_id  BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  show_id     BIGINT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_id     BIGINT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  price_cents INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_show_id ON booking_items(show_id);

-- 3. Backfill booking_items for all existing bookings
INSERT INTO booking_items (booking_id, show_id, seat_id, price_cents)
SELECT
  b.id AS booking_id,
  b.show_id,
  s.seat_id,
  COALESCE(ss.price_cents, (b.total_cents / GREATEST(array_length(b.seat_ids, 1), 1))) AS price_cents
FROM bookings b
CROSS JOIN LATERAL UNNEST(b.seat_ids) AS s(seat_id)
LEFT JOIN show_seats ss ON ss.show_id = b.show_id AND ss.seat_id = s.seat_id
ON CONFLICT (booking_id, seat_id) DO NOTHING;
