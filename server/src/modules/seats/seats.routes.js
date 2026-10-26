/**
 * seats.routes.js – Routes for /api/v1/shows
 */
import { Router } from 'express';
import { optionalAuth } from '../../common/middleware/auth.js';
import { seatsController } from './seats.controller.js';

const router = Router();

// GET /api/v1/shows/:id/seats (optionalAuth)
router.get('/:id/seats', optionalAuth, seatsController.getShowSeats);

export default router;
