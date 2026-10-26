/**
 * catalog.controller.js – Thin controller for catalog endpoints
 */
import { catalogService } from './catalog.service.js';

export const catalogController = {
  async getMovies(_req, res, next) {
    try {
      const data = await catalogService.getMovies();
      res.json(data);
    } catch (err) {
      next(err);
    }
  },

  async getMovieShows(req, res, next) {
    try {
      const data = await catalogService.getMovieShows(req.params.id);
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
};
