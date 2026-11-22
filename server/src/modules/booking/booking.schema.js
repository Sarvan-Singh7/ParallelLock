/**
 * booking.schema.js – Zod validation schemas for booking endpoints
 */
import { z } from 'zod';

export const idempotencyKeySchema = z
  .string()
  .min(1, 'Idempotency-Key must not be empty.')
  .max(100, 'Idempotency-Key must not exceed 100 characters.');

export const holdSchema = z.object({
  seatIds: z
    .array(z.coerce.number().int().positive())
    .min(1, 'At least 1 seat must be selected.')
    .max(6, 'At most 6 seats can be held at once.')
    .refine((items) => new Set(items).size === items.length, {
      message: 'Duplicate seat IDs are not allowed.',
    }),
});

export const paySchema = z.object({
  method: z.string().min(1, 'Payment method is required.'),
});
