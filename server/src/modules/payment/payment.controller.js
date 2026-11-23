/**
 * payment.controller.js – Webhook ingestion + admin refund controller (P2-M3)
 */
import { paymentService } from './payment.service.js';
import { errors } from '../../common/errors.js';

export const paymentController = {
  async handleWebhook(req, res, next) {
    try {
      const signature =
        req.headers['x-signature'] ||
        req.headers['x-webhook-signature'] ||
        req.headers['stripe-signature'];

      const rawBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

      // Verify HMAC-SHA256 signature using timingSafeEqual
      const isValid = paymentService.verifyWebhookSignature(rawBuffer, signature);
      if (!isValid) {
        return res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Webhook signature verification failed.',
          },
        });
      }

      let payload;
      try {
        payload = JSON.parse(rawBuffer.toString('utf8'));
      } catch (parseErr) {
        return res.status(400).json({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid JSON payload.',
          },
        });
      }

      const eventId = payload.id;
      const eventType = payload.event;
      const data = payload.data || {};
      const { provider_ref, provider_payment_id, amount_cents, currency } = data;

      if (!provider_ref) {
        return res.status(200).json({ received: true, ignored: true });
      }

      const isSuccess = eventType === 'payment.succeeded';

      const result = await paymentService.finalizePayment({
        providerRef: provider_ref,
        providerPaymentId: provider_payment_id || null,
        amountCents: amount_cents,
        currency: currency || 'INR',
        isSuccess,
        eventId,
        rawPayload: payload,
      });

      // Amount mismatch validation error gets re-thrown as 422
      return res.status(200).json({ received: true, result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/admin/retry-refund/:bookingId
   * Retry a stuck REFUND_PENDING booking (called by admin or sweeper in P2-M4).
   */
  async retryRefund(req, res, next) {
    try {
      const { bookingId } = req.params;
      const result = await paymentService.retryRefund(bookingId);
      return res.status(200).json({ bookingId, result });
    } catch (err) {
      next(err);
    }
  },
};
