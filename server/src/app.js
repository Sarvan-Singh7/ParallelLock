/**
 * app.js – builds and exports the Express application.
 *
 * This module never calls app.listen() so it can be imported cleanly by
 * tests without binding a port.
 */
// TODO(phase-5): structured logging and request ids
import express from 'express';
import { env } from './config/env.js';
import { cors } from './common/middleware/cors.js';
import { errorHandler } from './common/middleware/errorHandler.js';

import authRoutes from './modules/auth/auth.routes.js';
import catalogRoutes from './modules/catalog/catalog.routes.js';
import seatsRoutes from './modules/seats/seats.routes.js';
import { holdsRouter, bookingRouter, meRouter } from './modules/booking/booking.routes.js';
import webhookRoutes from './modules/payment/payment.routes.js';

const app = express();

// Trust proxy: Configured as a strict hop count (e.g. TRUST_PROXY=1 for Render/Cloudflare)
// Applied ONLY when explicitly set via environment variable.
// Must match the exact number of upstream reverse proxies to prevent IP header spoofing.
if (typeof env.TRUST_PROXY === 'number') {
  app.set('trust proxy', env.TRUST_PROXY);
}

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors);

// Mount raw body parser for payment webhooks BEFORE express.json()
app.post('/api/v1/webhooks/payments', express.raw({ type: 'application/json' }));

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
app.use('/api/v1/webhooks', webhookRoutes);

// ── Error handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

export default app;
