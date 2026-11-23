-- Migration: 005_payments_and_webhooks.sql
-- Payments ledger, webhook events deduplication, and refund status extensions

-- 1. Update bookings status constraint to include REFUND_PENDING and REFUNDED
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('CREATED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'PAYMENT_PENDING', 'REFUND_PENDING', 'REFUNDED'));

-- 2. Payments table
CREATE TABLE IF NOT EXISTS payments (
  id                  BIGSERIAL PRIMARY KEY,
  booking_id          BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  provider_ref        TEXT UNIQUE NOT NULL,
  provider_payment_id TEXT NULL,
  amount_cents        INT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('INITIATED', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_ref);

-- 3. Payment events table for webhook deduplication
CREATE TABLE IF NOT EXISTS payment_events (
  provider_event_id TEXT PRIMARY KEY,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
