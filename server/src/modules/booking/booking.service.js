/**
 * booking.service.js – Core business logic for seat holds, payments, and releases
 *
 * Implements strict row-locking guarantees inside isolated transactions.
 */
import { withTransaction } from '../../db/tx.js';
import { env } from '../../config/env.js';
import { errors } from '../../common/errors.js';
import { generateBookingRef } from '../../common/ref.js';
import { bookingRepo } from './booking.repo.js';
import { showSeatRepo } from './showSeat.repo.js';
import { paymentService } from '../payment/payment.service.js';

function computeDisplayStatus(status, holdExpiresAt) {
  const isExpired = new Date(holdExpiresAt).getTime() <= Date.now();
  if (status === 'CONFIRMED') return 'CONFIRMED';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'PAYMENT_PENDING') return 'PROCESSING_PAYMENT';
  if (status === 'EXPIRED' || (status === 'CREATED' && isExpired)) return 'EXPIRED';
  return 'ACTIVE_HOLD';
}

function formatBooking(row, seats) {
  const holdExpiresAt = row.hold_expires_at instanceof Date
    ? row.hold_expires_at.toISOString()
    : new Date(row.hold_expires_at).toISOString();

  const paidAt = row.paid_at
    ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : new Date(row.paid_at).toISOString())
    : null;

  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString();

  const startsAt = row.starts_at instanceof Date
    ? row.starts_at.toISOString()
    : new Date(row.starts_at).toISOString();

  return {
    id: String(row.id),
    ref: row.ref,
    status: row.status,
    displayStatus: computeDisplayStatus(row.status, holdExpiresAt),
    totalCents: Number(row.total_cents),
    holdExpiresAt,
    paidAt,
    createdAt,
    show: {
      id: String(row.show_id || row.s_id),
      startsAt,
      language: row.language,
      format: row.format,
      screenName: row.screen_name,
      movie: {
        id: String(row.movie_id),
        title: row.movie_title,
        certificate: row.movie_certificate,
        durationMin: Number(row.movie_duration_min),
        posterUrl: row.movie_poster_url,
      },
      theater: {
        name: row.theater_name,
        address: row.theater_address,
        city: row.theater_city,
      },
    },
    seats,
  };
}

export const bookingService = {
  /**
   * HOLD ALGORITHM (The core guarantee of ParallelLock):
   * 1. SET LOCAL lock_timeout = '2s'; statement_timeout = '5s'
   * 2. Verify show is upcoming (starts_at > now())
   * 3. Expire caller's stale bookings, check for existing active hold
   * 4. Ordered SELECT ... FOR UPDATE on show_seats
   * 5. Verify all requested seats exist and are active (else 422)
   * 6. Verify all requested seats are free (else 409 SEAT_UNAVAILABLE with sorted IDs)
   * 7. Insert booking and mark show_seats HELD
   * 8. Commit
   */
  async createHold({ showId, seatIds, userId, idempotencyKey }) {
    const bookingRow = await withTransaction(async (client) => {
      // 1. Set transaction timeouts
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      // 2. Lock caller's user row to serialize concurrent hold requests from the same user
      const user = await bookingRepo.lockUserRow(userId, client);
      if (!user) {
        throw errors.unauthorized('User not found or session expired. Please log in again.');
      }

      // 3. Check for existing booking with this idempotency key
      if (idempotencyKey) {
        const existing = await bookingRepo.findBookingByIdempotencyKey(userId, idempotencyKey, client);
        if (existing) {
          const reqSorted = [...seatIds].map(Number).sort((a, b) => a - b);
          const existingSorted = [...existing.seat_ids].map(Number).sort((a, b) => a - b);
          const isSame =
            reqSorted.length === existingSorted.length &&
            reqSorted.every((id, idx) => id === existingSorted[idx]);

          if (isSame) {
            return { ...existing, replayed: true };
          }
          throw errors.idempotencyKeyReused();
        }
      }

      // 4. Load show and verify not closed
      const show = await bookingRepo.findShowForHold(showId, client);
      if (!show) {
        throw errors.notFound('Show not found.');
      }
      if (show.is_closed) {
        throw errors.showClosed();
      }

      // 5. Clean up caller's stale holds and verify no active hold exists
      await bookingRepo.expireStaleUserHolds(showId, userId, client);
      const activeHold = await bookingRepo.findActiveUserHold(showId, userId, client);
      if (activeHold) {
        throw errors.activeHoldExists(String(activeHold.id));
      }

      // 6. Ordered row lock on requested show_seats
      const lockedSeats = await showSeatRepo.lockSeatsForHold(showId, seatIds, client);

      // 7. If fewer rows returned, one or more seats don't exist or are blocked (is_active=false)
      if (lockedSeats.length < seatIds.length) {
        throw errors.invalidSeats('One or more selected seats do not exist or are blocked.');
      }

      // 8. Check if any seat is not free
      const unavailableSeatIds = lockedSeats
        .filter((s) => !s.is_free)
        .map((s) => Number(s.seat_id))
        .sort((a, b) => a - b);

      if (unavailableSeatIds.length > 0) {
        throw errors.seatUnavailable(unavailableSeatIds);
      }

      // 9. Calculate total and insert booking using DB clock for hold_expires_at
      const totalCents = lockedSeats.reduce((sum, s) => sum + Number(s.price_cents), 0);
      const ref = generateBookingRef();

      let booking;
      try {
        booking = await bookingRepo.insertBooking(
          {
            ref,
            userId,
            showId,
            seatIds,
            totalCents,
            holdSeconds: env.HOLD_SECONDS,
            idempotencyKey: idempotencyKey || null,
          },
          client
        );
      } catch (err) {
        // Unique index violation on (user_id, show_id) WHERE status='CREATED'
        if (err.code === '23505' && err.constraint === 'uq_bookings_active_user_show') {
          throw errors.activeHoldExists(null);
        }
        throw err;
      }

      // Update show_seats to HELD using database-generated hold_expires_at
      await showSeatRepo.markHeld(showId, seatIds, booking.id, booking.hold_expires_at, client);

      return booking;
    });

    const fullBooking = await this.getBookingById({ bookingId: bookingRow.id, userId });
    return {
      ...fullBooking,
      replayed: Boolean(bookingRow.replayed),
    };
  },

  /**
   * Load booking details (restricted to owner).
   */
  async getBookingById({ bookingId, userId }) {
    let row = await bookingRepo.findBookingDetails(bookingId);
    if (!row) {
      throw errors.notFound('Booking not found.');
    }
    if (String(row.user_id) !== String(userId)) {
      throw errors.forbidden('You do not have permission to view this booking.');
    }

    // Lazy crash recovery for stale PAYMENT_PENDING (>2 min)
    if (row.status === 'PAYMENT_PENDING') {
      await withTransaction(async (client) => {
        await bookingRepo.recoverStalePaymentPending(bookingId, client);
      });
      row = await bookingRepo.findBookingDetails(bookingId);
    }

    const seats = await showSeatRepo.getSeatsForBooking(row.show_id, row.seat_ids);
    return {
      booking: formatBooking(row, seats),
      serverTime: new Date().toISOString(),
    };
  },

  /**
   * PAY (Mock):
   * 1. Quick read: owner check, status CREATED, hold not expired.
   * 2. Strategy call OUTSIDE transaction.
   * 3. Finalize in transaction: lock booking, update show_seats to BOOKED, confirm booking.
   */
  async payBooking({ bookingId, userId, method }) {
    // 1️⃣ Quick validation – fetch booking details (read‑only)
    let row = await bookingRepo.findBookingDetails(bookingId);
    if (!row) throw errors.notFound('Booking not found.');
    if (String(row.user_id) !== String(userId))
      throw errors.forbidden('You do not have permission to pay for this booking.');

    // Lazy crash recovery if stuck in PAYMENT_PENDING for over 2 minutes
    if (row.status === 'PAYMENT_PENDING') {
      await withTransaction(async (client) => {
        await bookingRepo.recoverStalePaymentPending(bookingId, client);
      });
      row = await bookingRepo.findBookingDetails(bookingId);
    }

    // 2️⃣ Idempotent re‑play handling – if already CONFIRMED return the same booking
    if (row.status === 'CONFIRMED') {
      const full = await this.getBookingById({ bookingId, userId });
      return { ...full, replayed: true };
    }
    // If actively in PAYMENT_PENDING within the 2-minute window, reject concurrent pay
    if (row.status === 'PAYMENT_PENDING') {
      throw errors.invalidState('Payment is already being processed for this booking.');
    }
    // Anything else besides CREATED is an illegal state for payment
    if (row.status !== 'CREATED') {
      throw errors.invalidState(`Booking is already ${row.status.toLowerCase()}.`);
    }
    if (row.is_past_expiry) {
      await bookingRepo.markExpired(bookingId);
      throw errors.holdExpired();
    }

    // 3️⃣ First transaction – lock the row and move it to PAYMENT_PENDING (extends hold by 3 min)
    let pendingSet = false;
    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");
      const locked = await bookingRepo.lockBookingForUpdate(bookingId, client);
      if (!locked) throw errors.notFound('Booking not found.');
      if (locked.status !== 'CREATED') {
        // Another concurrent request may have raced us – abort so caller sees conflict
        throw errors.invalidState(`Booking is already ${locked.status.toLowerCase()}.`);
      }
      // Mark as pending and extend hold by 3 minutes
      await bookingRepo.setPaymentPending(bookingId, client);
      pendingSet = true;
    });

    // 4️⃣ External payment – runs outside any DB transaction so we don't hold locks
    try {
      await paymentService.processPayment({
        method,
        bookingId,
        totalCents: Number(row.total_cents),
      });
    } catch (err) {
      // If payment fails we roll back the pending flag so the client can retry
      if (pendingSet) {
        await withTransaction(async (client) => {
          await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");
          await bookingRepo.revertPaymentPending(bookingId, client);
        });
      }
      throw err; // let the outer error handler return 500 / appropriate code
    }

    // 5️⃣ Final transaction – lock row again, mark seats BOOKED, confirm booking
    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");
      const locked = await bookingRepo.lockBookingForUpdate(bookingId, client);
      if (!locked) throw errors.notFound('Booking not found.');
      if (locked.status !== 'PAYMENT_PENDING') {
        // TODO(P2-M3): Late payment arrived after recovery/cancellation; trigger refund path
        throw errors.invalidState(
          `Cannot confirm booking: expected PAYMENT_PENDING but found ${locked.status}. Refund required.`
        );
      }
      // Mark all seats as BOOKED
      const updatedCount = await showSeatRepo.markBooked(locked.show_id, bookingId, client);
      if (updatedCount !== locked.seat_ids.length) {
        throw errors.invalidState('Failed to secure all held seats during payment finalization.');
      }
      // Finally confirm the booking (sets CONFIRMED and paid_at)
      await bookingRepo.confirmBooking(bookingId, client);
    });

    const full = await this.getBookingById({ bookingId, userId });
    return { ...full, replayed: false };
  },



  /**
   * RELEASE:
   * Owner only; sets booking CANCELLED (or EXPIRED), returns seats to AVAILABLE.
   */
  async releaseBooking({ bookingId, userId }) {
    const row = await bookingRepo.findBookingDetails(bookingId);
    if (!row) {
      throw errors.notFound('Booking not found.');
    }
    if (String(row.user_id) !== String(userId)) {
      throw errors.forbidden('You do not have permission to release this booking.');
    }
    if (row.status === 'PAYMENT_PENDING') {
      throw errors.invalidState('Cannot release booking while payment is processing.');
    }
    if (row.status !== 'CREATED') {
      throw errors.invalidState(`Cannot release booking with status ${row.status}.`);
    }

    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      const locked = await bookingRepo.lockBookingForUpdate(bookingId, client);
      if (!locked) {
        throw errors.notFound('Booking not found.');
      }
      if (locked.status === 'PAYMENT_PENDING') {
        throw errors.invalidState('Cannot release booking while payment is processing.');
      }
      if (locked.status !== 'CREATED') {
        throw errors.invalidState(`Cannot release booking with status ${locked.status}.`);
      }

      if (locked.is_expired) {
        await bookingRepo.markExpired(bookingId, client);
      } else {
        await bookingRepo.markCancelled(bookingId, client);
      }

      await showSeatRepo.releaseHeldSeats(locked.show_id, bookingId, client);
    });
  },

  /**
   * List caller's bookings (newest first, limit 50).
   */
  async getMyBookings(userId) {
    const rows = await bookingRepo.listUserBookings(userId, 50);
    const bookings = await Promise.all(
      rows.map(async (row) => {
        const seats = await showSeatRepo.getSeatsForBooking(row.show_id, row.seat_ids);
        return formatBooking(row, seats);
      })
    );
    return { bookings };
  },
};
