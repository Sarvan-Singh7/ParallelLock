-- Migration: 003_payment_pending.sql
-- Add PAYMENT_PENDING to the booking status check constraint so we can gate duplicate charges.
--
-- Why: between "fire payment strategy" and "mark CONFIRMED" there is a window
-- where a second concurrent Pay request reads status = 'CREATED' and fires the
-- charge again. PAYMENT_PENDING closes that window: the first request flips the
-- row to PAYMENT_PENDING inside a transaction, all other concurrent Pay requests
-- see the new status and get a 409, then we flip to CONFIRMED (or roll back to
-- CREATED on payment failure).

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('CREATED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'PAYMENT_PENDING'));
