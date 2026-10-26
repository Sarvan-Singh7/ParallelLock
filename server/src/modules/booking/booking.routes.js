/**
 * booking.routes.js – Routes for holds, payments, cancellations, and user bookings
 */
import { Router } from 'express';
import { requireAuth } from '../../common/middleware/auth.js';
import { validateBody } from '../../common/validate.js';
import { holdSchema, paySchema } from './booking.schema.js';
import { bookingController } from './booking.controller.js';

// Holds router: mounted on /api/v1/shows
export const holdsRouter = Router();
holdsRouter.post('/:id/holds', requireAuth, validateBody(holdSchema), bookingController.createHold);

// Bookings router: mounted on /api/v1/bookings
export const bookingRouter = Router();
bookingRouter.get('/:id',      requireAuth, bookingController.getBooking);
bookingRouter.post('/:id/pay', requireAuth, validateBody(paySchema), bookingController.payBooking);
bookingRouter.delete('/:id',   requireAuth, bookingController.releaseBooking);

// Me router: mounted on /api/v1/me
export const meRouter = Router();
meRouter.get('/bookings', requireAuth, bookingController.getMyBookings);

export default bookingRouter;
