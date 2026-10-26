/**
 * seats.controller.js – Thin controller for seats endpoints
 */
import { seatsService } from './seats.service.js';

export const seatsController = {
  async getShowSeats(req, res, next) {
    try {
      const userId = req.user?.id || null;
      const data = await seatsService.getShowSeats(req.params.id, userId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
};
