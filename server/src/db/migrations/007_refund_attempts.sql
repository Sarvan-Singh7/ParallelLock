-- Migration 007: Add refund_attempts column to bookings table (V0)
-- Limits automatic refund retries to MAX_REFUND_RETRIES (5) in background sweeper

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS refund_attempts INT NOT NULL DEFAULT 0;
