/**
 * paymentFactory.js – Strategy factory for payment providers
 */
import { errors } from '../../common/errors.js';
import { mockStrategy } from './strategies/mockStrategy.js';

export const paymentFactory = {
  getStrategy(method) {
    if (method === 'MOCK') {
      return mockStrategy;
    }
    // TODO(phase-2): Add real payment gateway strategies (e.g. Stripe, Razorpay)
    throw errors.validation(`Unsupported payment method '${method}'. Must be 'MOCK'.`, { method });
  },
};
