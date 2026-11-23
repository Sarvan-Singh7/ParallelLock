/**
 * payment.service.js – Core orchestrator for payments, webhooks, and refunds (P2-M3)
 *
 * Implements strict three-phase payment execution:
 * Phase A (short tx): Lock booking, set PAYMENT_PENDING, extend hold, insert payment INITIATED.
 * Phase B (outside tx): Call external payment gateway strategy.
 * Phase C (finalize tx): Atomically lock booking, verify seats, mark BOOKED & CONFIRMED or trigger refund path.
 */
import crypto from 'node:crypto';
import { withTransaction } from '../../db/tx.js';
import { paymentRepo } from './payment.repo.js';
import { bookingRepo } from '../booking/booking.repo.js';
import { showSeatRepo } from '../booking/showSeat.repo.js';
import { paymentFactory } from './paymentFactory.js';
import { errors } from '../../common/errors.js';
import { env } from '../../config/env.js';

export const paymentService = {
  // Call gateway strategy
  async processPayment({ method, bookingId, totalCents, providerRef }) {
    const strategy = paymentFactory.getStrategy(method);
    return strategy.processPayment({ bookingId, totalCents, providerRef });
  },

  // Call gateway refund
  async refundPayment({ method = 'MOCK', providerRef, amountCents }) {
    const strategy = paymentFactory.getStrategy(method);
    return strategy.refundPayment({ providerRef, amountCents });
  },

  /**
   * Finalize payment (runs in ONE atomic transaction).
   * Shared by both synchronous Phase C and asynchronous Webhook ingestion.
   * Lock order: bookings -> payments -> show_seats.
   */
  async finalizePayment({
    providerRef,
    providerPaymentId = null,
    amountCents,
    currency = 'INR',
    isSuccess = true,
    eventId = null,
    rawPayload = null,
  }) {
    let refundPlan = null;
    let finalResult = null;

    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      // 1. Deduplicate webhook event if eventId provided (ON CONFLICT DO NOTHING)
      if (eventId) {
        const recorded = await paymentRepo.recordPaymentEvent(
          { providerEventId: eventId, payload: rawPayload || {} },
          client
        );
        if (!recorded) {
          // Event already processed -> return 200 no-op
          finalResult = { duplicate: true };
          return;
        }
      }

      // 2. Lookup payment by provider_ref
      const payment = await paymentRepo.findPaymentByProviderRef(providerRef, client);
      if (!payment) {
        // Unknown provider_ref: return 200 and ignore
        finalResult = { unknown: true };
        return;
      }

      // Validate amount
      if (Number(payment.amount_cents) !== Number(amountCents)) {
        throw errors.validation('Webhook amount does not match initiated payment amount.');
      }

      // Lock order: 1) booking row
      const lockedBooking = await bookingRepo.lockBookingForUpdate(payment.booking_id, client);
      if (!lockedBooking) {
        throw errors.notFound('Associated booking not found.');
      }

      // Lock order: 2) payment row
      const lockedPayment = await paymentRepo.lockPaymentForUpdate(payment.id, client);

      // Handle FAILED event
      if (!isSuccess) {
        // Late FAILED event after SUCCEEDED must NOT downgrade
        if (lockedPayment.status === 'SUCCEEDED' || lockedPayment.status === 'REFUNDED') {
          finalResult = { ignored: true };
          return;
        }

        await paymentRepo.updatePaymentStatus(lockedPayment.id, 'FAILED', null, client);
        if (lockedBooking.status === 'PAYMENT_PENDING') {
          await bookingRepo.revertPaymentPending(lockedBooking.id, client);
        }
        finalResult = { failed: true };
        return;
      }

      // Handle SUCCEEDED event
      if (lockedPayment.status === 'SUCCEEDED') {
        finalResult = { replayed: true, bookingId: lockedBooking.id };
        return;
      }

      // Mark payment SUCCEEDED
      await paymentRepo.updatePaymentStatus(lockedPayment.id, 'SUCCEEDED', providerPaymentId, client);

      // Lock order: 3) show_seats
      // Verify every seat is still HELD under this booking
      const updatedCount = await showSeatRepo.markBooked(
        lockedBooking.show_id,
        lockedBooking.id,
        client
      );

      if (updatedCount === lockedBooking.seat_ids.length) {
        // All seats secured! Confirm booking
        await bookingRepo.confirmBooking(lockedBooking.id, client);
        finalResult = { confirmed: true, bookingId: lockedBooking.id };
      } else {
        // Seats were released or claimed by another user!
        // Never double book and never return a 500: transition booking to REFUND_PENDING
        await bookingRepo.setRefundPending(lockedBooking.id, client);

        refundPlan = {
          bookingId: lockedBooking.id,
          providerRef: lockedPayment.provider_ref,
          amountCents: Number(lockedPayment.amount_cents),
          provider: lockedPayment.provider,
        };
        finalResult = { refundRequired: true, bookingId: lockedBooking.id };
      }
    });

    // Execute refund OUTSIDE the finalize transaction if seats were lost
    if (refundPlan) {
      await this.executeRefund(refundPlan);
    }

    return finalResult;
  },

  /**
   * Executes external refund and commits REFUNDED state.
   */
  async executeRefund({ bookingId, providerRef, amountCents, provider = 'MOCK' }) {
    try {
      // 1. Call provider refund outside DB transaction
      await this.refundPayment({ method: provider, providerRef, amountCents });

      // 2. In second transaction: update booking and payment to REFUNDED
      await withTransaction(async (client) => {
        await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");
        await bookingRepo.setRefunded(bookingId, client);
        const payment = await paymentRepo.findPaymentByProviderRef(providerRef, client);
        if (payment) {
          await paymentRepo.updatePaymentStatus(payment.id, 'REFUNDED', null, client);
        }
      });
      return { success: true, status: 'REFUNDED' };
    } catch (err) {
      // If refund call fails, booking remains REFUND_PENDING for sweeper / retryRefund
      console.error(`Refund failed for booking ${bookingId}:`, err.message);
      return { success: false, status: 'REFUND_PENDING', error: err.message };
    }
  },

  /**
   * Retry refund for bookings stuck in REFUND_PENDING (called by admin or sweeper).
   */
  async retryRefund(bookingId) {
    const payment = await paymentRepo.findLatestPaymentByBookingId(bookingId);
    if (!payment) {
      throw errors.notFound('No payment found for this booking.');
    }
    return this.executeRefund({
      bookingId,
      providerRef: payment.provider_ref,
      amountCents: Number(payment.amount_cents),
      provider: payment.provider,
    });
  },

  /**
   * Verifies HMAC-SHA256 signature for incoming webhooks.
   */
  verifyWebhookSignature(rawBodyBuffer, signatureHeader) {
    if (!rawBodyBuffer || !signatureHeader) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', env.WEBHOOK_SECRET)
      .update(rawBodyBuffer)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(signatureHeader, 'utf8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  },
};
