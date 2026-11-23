/**
 * payment.routes.js – Webhook routes (no auth required)
 */
import { Router } from 'express';
import { paymentController } from './payment.controller.js';

const router = Router();

// POST /api/v1/webhooks/payments (mounted with raw body parser)
router.post('/payments', paymentController.handleWebhook);

export default router;
