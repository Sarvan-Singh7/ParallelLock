/**
 * payment.service.js – Orchestrates payment processing outside DB transactions
 */
import { paymentFactory } from './paymentFactory.js';

export const paymentService = {
  /**
   * Executes payment via the chosen strategy.
   * Runs outside database transactions to prevent holding DB locks during external I/O.
   */
  async processPayment({ method, bookingId, totalCents }) {
    const strategy = paymentFactory.getStrategy(method);
    return strategy.processPayment({ bookingId, totalCents });
  },
};
