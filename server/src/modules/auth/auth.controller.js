/**
 * auth.controller.js – Thin controller for auth endpoints
 */
import { authService } from './auth.service.js';
import { recordLoginFailure, recordLoginSuccess } from '../../common/middleware/rateLimiter.js';

export const authController = {
  async register(req, res, next) {
    try {
      const result = await authService.register(req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const result = await authService.login(req.body);
      // Successful login resets the failure counter for this email
      await recordLoginSuccess(req);
      res.status(200).json(result);
    } catch (err) {
      // Failed login (e.g. 401 INVALID_CREDENTIALS) increments failure counters
      if (err.status === 401) {
        await recordLoginFailure(req);
      }
      next(err);
    }
  },
};
