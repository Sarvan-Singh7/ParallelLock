import { z } from 'zod';

const schema = z.object({
  DATABASE_URL:      z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  JWT_SECRET:        z.string().min(16),
  WEBHOOK_SECRET:    z.string().min(16),
  PORT:              z.coerce.number().int().positive().default(4000),
  // Seat hold duration in seconds; defaults to 8 minutes
  HOLD_SECONDS:      z.coerce.number().int().positive().default(480),
  CLIENT_ORIGIN:     z.string().url().default('http://localhost:5173'),
  MOCK_PAYMENT_FAIL: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  MOCK_PAYMENT_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  MOCK_PAYMENT_MODE: z.enum(['sync', 'async']).default('sync'),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  NODE_ENV:          z.string().default('development'),
  // Rate limiting & Proxy configuration (R1)
  TRUST_PROXY:       z.coerce.number().int().nonnegative().optional(),
  ENABLE_RATE_LIMITER: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  RATE_LIMIT_HOLDS_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_FAIL_IP_PER_15MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LOGIN_FAIL_EMAIL_PER_15MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REGISTER_PER_10MIN: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
