/**
 * booking.controller.js – Thin controller for booking endpoints
 */
import { bookingService } from './booking.service.js';

export const bookingController = {
  async createHold(req, res, next) {
    try {
      const showId = req.params.id;
      const { seatIds } = req.body;
      const userId = req.user.id;

      const result = await bookingService.createHold({ showId, seatIds, userId });
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
