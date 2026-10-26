import { z } from 'zod';

const schema = z.object({
  DATABASE_URL:      z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  JWT_SECRET:        z.string().min(16),
  PORT:              z.coerce.number().int().positive().default(4000),
  // Seat hold duration in seconds; defaults to 8 minutes
  HOLD_SECONDS:      z.coerce.number().int().positive().default(480),
  CLIENT_ORIGIN:     z.string().url().default('http://localhost:5173'),
  MOCK_PAYMENT_FAIL: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  NODE_ENV:          z.string().default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
