/**
 * bookingStateMachine.js – Explicit state machine for booking lifecycle (P2-M4)
 *
 * Valid states:
 * - CREATED: Hold active, waiting for payment.
 * - PAYMENT_PENDING: Payment in flight, hold extended with 2-min crash recovery window.
 * - CONFIRMED: Payment succeeded and physical seats locked to BOOKED (Terminal).
 * - EXPIRED: Hold expired without payment, seats released.
 * - CANCELLED: Released by customer before expiry (Terminal).
 * - REFUND_PENDING: Payment taken but seats lost / collision; refund scheduled.
 * - REFUNDED: Gateway refund executed and ledger reconciled (Terminal).
 */
import { errors } from '../../common/errors.js';

export const ALLOWED_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED']),
  PAYMENT_PENDING: Object.freeze(['CONFIRMED', 'CREATED', 'EXPIRED', 'REFUND_PENDING']),
  EXPIRED: Object.freeze(['CONFIRMED', 'REFUND_PENDING']),
  CANCELLED: Object.freeze(['REFUND_PENDING']),
  REFUND_PENDING: Object.freeze(['REFUNDED']),
  CONFIRMED: Object.freeze([]),
  REFUNDED: Object.freeze([]),
});

/**
 * Asserts that transitioning from `fromStatus` to `toStatus` is strictly legal.
 * Throws errors.invalidState(409) if the transition violates the state graph.
 *
 * @param {string} fromStatus - Current booking status
 * @param {string} toStatus - Desired target booking status
 * @throws {AppError} 409 INVALID_STATE
 */
export function assertTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return; // Idempotent no-op
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed) {
    throw errors.invalidState(`Unknown booking status: '${fromStatus}'.`);
  }

  if (!allowed.includes(toStatus)) {
    throw errors.invalidState(
      `Illegal booking transition from '${fromStatus}' to '${toStatus}'.`
    );
  }
}
