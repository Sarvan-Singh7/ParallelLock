/**
 * mockStrategy.js – Mock payment strategy for dev & testing
 *
 * Always succeeds unless MOCK_PAYMENT_FAIL=true in environment.
 * Supports configurable delay (MOCK_PAYMENT_DELAY_MS) and tracks charge attempts.
 * Times out at 30 seconds to prevent slow charges from outliving the recovery window.
 */
import { env } from '../../../config/env.js';
import { errors } from '../../../common/errors.js';

let chargeCount = 0;

export const mockStrategy = {
  getChargeCount() {
    return chargeCount;
  },

  resetChargeCount() {
    chargeCount = 0;
  },

  async processPayment({ bookingId, totalCents }) {
    chargeCount++;

    // 30-second timeout ceiling to ensure external I/O cannot outlive the 2-minute recovery window
    const timeoutMs = 30000;
    const delayMs = env.MOCK_PAYMENT_DELAY_MS || 0;

    if (delayMs > timeoutMs) {
      throw errors.serviceUnavailable('Payment gateway timed out.');
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (env.MOCK_PAYMENT_FAIL) {
      throw errors.validation('Payment simulated failure.', { bookingId, totalCents });
    }

    return {
      success: true,
      transactionId: `mock_tx_${Date.now()}`,
    };
  },
};
