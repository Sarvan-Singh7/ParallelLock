/**
 * mockStrategy.js – Mock payment strategy for dev & testing
 *
 * Always succeeds unless MOCK_PAYMENT_FAIL=true in environment.
 */
import { env } from '../../../config/env.js';
import { errors } from '../../../common/errors.js';

export const mockStrategy = {
  async processPayment({ bookingId, totalCents }) {
    if (env.MOCK_PAYMENT_FAIL) {
      throw errors.validation('Payment simulated failure.', { bookingId, totalCents });
    }
    return {
      success: true,
      transactionId: `mock_tx_${Date.now()}`,
    };
  },
};
