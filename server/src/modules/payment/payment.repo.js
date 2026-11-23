/**
 * payment.repo.js – Repository for payments ledger and payment_events deduplication
 */
import pool from '../../db/pool.js';

export const paymentRepo = {
  // Insert initial payment attempt (Phase A)
  async createPayment(
    { bookingId, provider, providerRef, providerPaymentId = null, amountCents, status = 'INITIATED' },
    client = pool
  ) {
    const { rows } = await client.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, provider_payment_id, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, booking_id, provider, provider_ref, provider_payment_id, amount_cents, status, created_at, updated_at`,
      [bookingId, provider, providerRef, providerPaymentId, amountCents, status]
    );
    return rows[0];
  },

  // Find payment by provider reference
  async findPaymentByProviderRef(providerRef, db = pool) {
    const { rows } = await db.query(
      `SELECT id, booking_id, provider, provider_ref, provider_payment_id, amount_cents, status, created_at, updated_at
       FROM payments
       WHERE provider_ref = $1`,
      [providerRef]
    );
    return rows[0] || null;
  },

  // Find latest payment for a booking
  async findLatestPaymentByBookingId(bookingId, db = pool) {
    const { rows } = await db.query(
      `SELECT id, booking_id, provider, provider_ref, provider_payment_id, amount_cents, status, created_at, updated_at
       FROM payments
       WHERE booking_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [bookingId]
    );
    return rows[0] || null;
  },

  // Lock payment row under transaction
  async lockPaymentForUpdate(paymentId, client) {
    const { rows } = await client.query(
      `SELECT id, booking_id, provider, provider_ref, provider_payment_id, amount_cents, status, created_at, updated_at
       FROM payments
       WHERE id = $1
       FOR UPDATE`,
      [paymentId]
    );
    return rows[0] || null;
  },

  // Conditional state updates (enforces strict valid state transitions)
  async updatePaymentStatus(id, newStatus, providerPaymentId = null, client = pool) {
    let query;
    let params;

    if (newStatus === 'SUCCEEDED') {
      // Only transition from INITIATED -> SUCCEEDED
      query = `UPDATE payments
               SET status = 'SUCCEEDED',
                   provider_payment_id = COALESCE($2, provider_payment_id),
                   updated_at = now()
               WHERE id = $1 AND status = 'INITIATED'
               RETURNING *`;
      params = [id, providerPaymentId];
    } else if (newStatus === 'FAILED') {
      // Only transition from INITIATED -> FAILED (never downgrade SUCCEEDED)
      query = `UPDATE payments
               SET status = 'FAILED',
                   updated_at = now()
               WHERE id = $1 AND status = 'INITIATED'
               RETURNING *`;
      params = [id];
    } else if (newStatus === 'REFUNDED') {
      // Only transition from SUCCEEDED -> REFUNDED
      query = `UPDATE payments
               SET status = 'REFUNDED',
                   updated_at = now()
               WHERE id = $1 AND status = 'SUCCEEDED'
               RETURNING *`;
      params = [id];
    } else {
      query = `UPDATE payments
               SET status = $2,
                   updated_at = now()
               WHERE id = $1
               RETURNING *`;
      params = [id, newStatus];
    }

    const { rows } = await client.query(query, params);
    return rows[0] || null;
  },

  // Deduplicate webhook events atomically in the same transaction
  // Returns provider_event_id if new; returns null if already exists (ON CONFLICT DO NOTHING)
  async recordPaymentEvent({ providerEventId, payload }, client) {
    const { rows } = await client.query(
      `INSERT INTO payment_events (provider_event_id, payload)
       VALUES ($1, $2)
       ON CONFLICT (provider_event_id) DO NOTHING
       RETURNING provider_event_id`,
      [providerEventId, JSON.stringify(payload)]
    );
    return rows[0] || null;
  },
};
