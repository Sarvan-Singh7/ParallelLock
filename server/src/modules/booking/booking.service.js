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
  async createHold({ showId, seatIds, userId }) {
    const bookingRow = await withTransaction(async (client) => {
      // 1. Set transaction timeouts
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      // 2. Load show and verify not closed
      const show = await bookingRepo.findShowForHold(showId, client);
      if (!show) {
        throw errors.notFound('Show not found.');
      }
      if (show.is_closed) {
        throw errors.showClosed();
      }

      // 3. Clean up caller's stale holds and verify no active hold exists
      await bookingRepo.expireStaleUserHolds(showId, userId, client);
      const activeHold = await bookingRepo.findActiveUserHold(showId, userId, client);
      if (activeHold) {
        throw errors.activeHoldExists(String(activeHold.id));
      }

      // 4. Ordered row lock on requested show_seats
      const lockedSeats = await showSeatRepo.lockSeatsForHold(showId, seatIds, client);

      // 5. If fewer rows returned, one or more seats don't exist or are blocked (is_active=false)
      if (lockedSeats.length < seatIds.length) {
        throw errors.invalidSeats('One or more selected seats do not exist or are blocked.');
      }

      // 6. Check if any seat is not free
      const unavailableSeatIds = lockedSeats
        .filter((s) => !s.is_free)
        .map((s) => Number(s.seat_id))
        .sort((a, b) => a - b);

      if (unavailableSeatIds.length > 0) {
        throw errors.seatUnavailable(unavailableSeatIds);
      }

      // 7. Calculate total and insert booking
      const totalCents = lockedSeats.reduce((sum, s) => sum + Number(s.price_cents), 0);
      const holdExpiresAt = new Date(Date.now() + env.HOLD_SECONDS * 1000);

      let booking;
      let inserted = false;
      let attempts = 0;

      while (!inserted && attempts < 3) {
        attempts++;
        const ref = generateBookingRef();
        try {
          booking = await bookingRepo.insertBooking(
            {
              ref,
              userId,
              showId,
              seatIds,
              totalCents,
              holdExpiresAt: holdExpiresAt.toISOString(),
            },
            client
          );
          inserted = true;
        } catch (err) {
          // Unique index violation on (user_id, show_id) WHERE status='CREATED'
          if (err.code === '23505' && err.constraint === 'uq_bookings_active_user_show') {
            const currentHold = await bookingRepo.findActiveUserHold(showId, userId, client);
            throw errors.activeHoldExists(currentHold ? String(currentHold.id) : null);
          }
          // Retry on unique ref collision
          if (err.code === '23505' && err.constraint === 'bookings_ref_key') {
            continue;
          }
          throw err;
        }
      }

      // Update show_seats to HELD
      await showSeatRepo.markHeld(showId, seatIds, booking.id, holdExpiresAt.toISOString(), client);

      return booking;
    });

    const fullBooking = await this.getBookingById({ bookingId: bookingRow.id, userId });
    return fullBooking;
  },

  /**
   * Load booking details (restricted to owner).
   */
  async getBookingById({ bookingId, userId }) {
    const row = await bookingRepo.findBookingDetails(bookingId);
    if (!row) {
      throw errors.notFound('Booking not found.');
    }
    if (String(row.user_id) !== String(userId)) {
      throw errors.forbidden('You do not have permission to view this booking.');
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
    // 1. Quick read validation
    const row = await bookingRepo.findBookingDetails(bookingId);
    if (!row) {
      throw errors.notFound('Booking not found.');
    }
    if (String(row.user_id) !== String(userId)) {
      throw errors.forbidden('You do not have permission to pay for this booking.');
    }
    if (row.status !== 'CREATED') {
      throw errors.invalidState(`Booking is already ${row.status.toLowerCase()}.`);
    }
    if (row.is_past_expiry) {
      await bookingRepo.markExpired(bookingId);
      throw errors.holdExpired();
    }

    // 2. Call payment strategy outside DB transaction
    await paymentService.processPayment({
      method,
      bookingId,
      totalCents: Number(row.total_cents),
    });

    // 3. Finalize in one transaction
    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      const locked = await bookingRepo.lockBookingForUpdate(bookingId, client);
      if (!locked) {
        throw errors.notFound('Booking not found.');
      }
      if (locked.status !== 'CREATED') {
        throw errors.invalidState(`Booking is already ${locked.status.toLowerCase()}.`);
      }
      if (locked.is_expired) {
        await bookingRepo.markExpired(bookingId, client);
        throw errors.holdExpired();
      }

      // Mark show_seats BOOKED
      const updatedCount = await showSeatRepo.markBooked(locked.show_id, bookingId, client);
      if (updatedCount !== locked.seat_ids.length) {
        throw errors.invalidState('Failed to secure all held seats during payment finalization.');
      }

      // Confirm booking
      await bookingRepo.confirmBooking(bookingId, client);
      // TODO(phase-2): refund path, webhooks, idempotency key
    });

    return this.getBookingById({ bookingId, userId });
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
    if (row.status !== 'CREATED') {
      throw errors.invalidState(`Cannot release booking with status ${row.status}.`);
    }

    await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';");

      if (row.is_past_expiry) {
        await bookingRepo.markExpired(bookingId, client);
      } else {
        await bookingRepo.markCancelled(bookingId, client);
      }

      await showSeatRepo.releaseHeldSeats(row.show_id, bookingId, client);
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
