/**
 * errors.js – canonical application error types
 *
 * AppError is thrown by services and caught by the error handler middleware.
 * The factory functions below match the codes required by the spec so that
 * callsites are readable: throw errors.notFound('Show not found').
 */

export class AppError extends Error {
  /**
   * @param {number} status   HTTP status code
   * @param {string} code     Machine-readable code (e.g. 'NOT_FOUND')
   * @param {string} message  Human-readable message
   * @param {object} details  Optional extra data (e.g. unavailableSeatIds)
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.name    = 'AppError';
    this.status  = status;
    this.code    = code;
    this.details = details;
  }
}

// ── factory helpers ─────────────────────────────────────────────────────────

export const errors = {
  validation:       (message, details) => new AppError(422, 'VALIDATION_ERROR',     message, details),
  invalidSeats:     (message, details) => new AppError(422, 'INVALID_SEATS',        message, details),
  unauthorized:     (message)          => new AppError(401, 'UNAUTHORIZED',          message ?? 'Authentication required.'),
  invalidCreds:     ()                 => new AppError(401, 'INVALID_CREDENTIALS',   'Email or password is incorrect.'),
  forbidden:        (message)          => new AppError(403, 'FORBIDDEN',             message ?? 'Access denied.'),
  notFound:         (message)          => new AppError(404, 'NOT_FOUND',             message ?? 'Resource not found.'),
  emailTaken:       ()                 => new AppError(409, 'EMAIL_TAKEN',           'An account with this email already exists.'),
  seatUnavailable:  (ids)              => new AppError(409, 'SEAT_UNAVAILABLE',      'One or more seats are no longer available.', { unavailableSeatIds: ids }),
  activeHoldExists: (bookingId)        => new AppError(409, 'ACTIVE_HOLD_EXISTS',    'You already have an active hold for this show.', { bookingId }),
  showClosed:       ()                 => new AppError(409, 'SHOW_CLOSED',           'This show has already started.'),
  invalidState:     (message)          => new AppError(409, 'INVALID_STATE',         message ?? 'Operation not allowed in the current state.'),
  holdExpired:      ()                 => new AppError(410, 'HOLD_EXPIRED',          'Your seat hold has expired.'),
  serviceUnavailable: ()               => new AppError(503, 'SERVICE_UNAVAILABLE',   'The service is temporarily busy. Please try again.'),
};
