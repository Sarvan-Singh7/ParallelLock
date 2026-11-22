-- 002_idempotency.sql
-- Add idempotency_key column and unique index scoped to user_id

ALTER TABLE bookings
  ADD COLUMN idempotency_key TEXT NULL;

-- Ensure an idempotency key can only be used once per user for active/confirmed records
CREATE UNIQUE INDEX uq_bookings_user_idempotency
  ON bookings (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
