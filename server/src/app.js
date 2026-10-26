/**
 * app.js – builds and exports the Express application.
 *
 * This module never calls app.listen() so it can be imported cleanly by
 * tests without binding a port.
 */
// TODO(phase-5): structured logging and request ids
import express from 'express';
import { cors } from './common/middleware/cors.js';
import { errorHandler } from './common/middleware/errorHandler.js';

import authRoutes from './modules/auth/auth.routes.js';
import catalogRoutes from './modules/catalog/catalog.routes.js';
import seatsRoutes from './modules/seats/seats.routes.js';
import { holdsRouter, bookingRouter, meRouter } from './modules/booking/booking.routes.js';

// TODO(phase-2): mount rate-limiter middleware here.

const app = express();

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors);
app.use(express.json());

// ── Health check (not counted in the 10 application endpoints) ───────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/movies', catalogRoutes);
app.use('/api/v1/shows', seatsRoutes);
app.use('/api/v1/shows', holdsRouter);
app.use('/api/v1/bookings', bookingRouter);
app.use('/api/v1/me', meRouter);

// ── Error handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

export default app;
