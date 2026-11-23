-- Migration: 004_payment_recovery.sql
-- Add payment_started_at to bookings and update unique index to include PAYMENT_PENDING

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_started_at TIMESTAMPTZ DEFAULT NULL;

-- Drop and recreate unique index to include PAYMENT_PENDING so at most one active hold or in-flight payment per user per show
DROP INDEX IF EXISTS uq_bookings_active_user_show;
CREATE UNIQUE INDEX uq_bookings_active_user_show
  ON bookings (user_id, show_id)
  WHERE status IN ('CREATED', 'PAYMENT_PENDING');
