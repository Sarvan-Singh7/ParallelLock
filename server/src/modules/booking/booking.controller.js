/**
 * booking.controller.js – Thin controller for booking endpoints
 */
import { bookingService } from './booking.service.js';
import { idempotencyKeySchema } from './booking.schema.js';
import { errors } from '../../common/errors.js';

export const bookingController = {
  async createHold(req, res, next) {
    try {
      const showId = req.params.id;
      const { seatIds } = req.body;
      const userId = req.user.id;
      const idempotencyKey = req.headers['idempotency-key'];

      if (idempotencyKey !== undefined) {
        const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
        if (!parsed.success) {
          throw errors.validation('Idempotency-Key must be a string between 1 and 100 characters.');
        }
      }

      const result = await bookingService.createHold({
        showId,
        seatIds,
        userId,
        idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
      });

      if (result.replayed) {
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(200).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getBooking(req, res, next) {
    try {
      const bookingId = req.params.id;
      const userId = req.user.id;

      const result = await bookingService.getBookingById({ bookingId, userId });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async payBooking(req, res, next) {
    try {
      const bookingId = req.params.id;
      const userId = req.user.id;
      const { method } = req.body;

      const result = await bookingService.payBooking({ bookingId, userId, method });
      if (result.replayed) {
        res.setHeader('Idempotency-Replayed', 'true');
      }
      if (result.async) {
        return res.status(202).json(result);
      }
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async releaseBooking(req, res, next) {
    try {
      const bookingId = req.params.id;
      const userId = req.user.id;

      await bookingService.releaseBooking({ bookingId, userId });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async getMyBookings(req, res, next) {
    try {
      const userId = req.user.id;
      const result = await bookingService.getMyBookings(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};
