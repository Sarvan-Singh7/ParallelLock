/**
 * mockStrategy.js – Mock payment strategy for dev & testing (P2-M3)
 *
 * Supports:
 * - Charge counter tracking (getChargeCount, resetChargeCount)
 * - Configurable delay (MOCK_PAYMENT_DELAY_MS)
 * - Configurable failure simulation (MOCK_PAYMENT_FAIL, MOCK_REFUND_FAIL)
 * - Sync vs Async mode (MOCK_PAYMENT_MODE = 'sync' | 'async')
 * - Refund execution (refundPayment)
 * - HMAC-SHA256 signed webhook generation for testing
 */
import crypto from 'node:crypto';
import { env } from '../../../config/env.js';
import { errors } from '../../../common/errors.js';

let chargeCount = 0;
let refundCount = 0;

export const mockStrategy = {
  getChargeCount() {
    return chargeCount;
  },

  resetChargeCount() {
    chargeCount = 0;
  },

  getRefundCount() {
    return refundCount;
  },

  resetRefundCount() {
    refundCount = 0;
  },

  async processPayment({ bookingId, totalCents, providerRef }) {
    chargeCount++;

    const timeoutMs = 30000;
    const delayMs = env.MOCK_PAYMENT_DELAY_MS || 0;

    if (delayMs > timeoutMs) {
      throw errors.serviceUnavailable('Payment gateway timed out.');
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (env.MOCK_PAYMENT_FAIL) {
      throw errors.validation('Payment simulated failure.', { bookingId, totalCents, providerRef });
    }

    if (env.MOCK_PAYMENT_MODE === 'async') {
      return {
        async: true,
        providerRef,
        providerPaymentId: `mock_async_${Date.now()}`,
      };
    }

    return {
      success: true,
      async: false,
      providerRef,
      providerPaymentId: `mock_tx_${Date.now()}`,
    };
  },

  async refundPayment({ providerRef, amountCents }) {
    refundCount++;

    if (process.env.MOCK_REFUND_FAIL === 'true') {
      throw errors.serviceUnavailable('Simulated refund gateway failure.');
    }

    return {
      success: true,
      refundId: `mock_rf_${Date.now()}`,
      providerRef,
      amountCents,
    };
  },

  /**
   * Helper to construct signed webhook payloads for tests.
   */
  createSignedWebhookPayload({
    eventId = `evt_${crypto.randomUUID()}`,
    eventType = 'payment.succeeded',
    providerRef,
    amountCents,
    currency = 'INR',
    providerPaymentId = `pay_${crypto.randomUUID()}`,
  }, secret = env.WEBHOOK_SECRET) {
    const payload = JSON.stringify({
      id: eventId,
      event: eventType, // 'payment.succeeded' | 'payment.failed'
      data: {
        provider_ref: providerRef,
        provider_payment_id: providerPaymentId,
        amount_cents: amountCents,
        currency,
      },
      created_at: new Date().toISOString(),
    });

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return { payload, signature, eventId };
  },
};
