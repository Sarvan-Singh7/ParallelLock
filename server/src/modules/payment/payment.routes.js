/**
 * payment.routes.js – Webhook and admin payment routes
 */
import { Router } from 'express';
import { paymentController } from './payment.controller.js';

const router = Router();

// POST /api/v1/webhooks/payments (mounted with raw body parser)
router.post('/payments', paymentController.handleWebhook);

export default router;

// Admin router (separate export, mounted at /api/v1/admin)
import { Router as AdminRouter } from 'express';
export const adminPaymentRouter = AdminRouter();
adminPaymentRouter.post('/retry-refund/:bookingId', paymentController.retryRefund);
