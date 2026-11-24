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

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.();
  } catch {}
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export function validateProductionSecrets(data) {
  if (data.NODE_ENV !== 'production') return { valid: true, errors: [] };

  const errors = [];

  if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long in production.');
  }

  const insecureKeywords = ['development', 'dev_', 'example', 'replace_with', 'super_secret', 'at_least_16_chars'];
  const isSecretInsecure = (secret) => {
    const lower = (secret || '').toLowerCase();
    return insecureKeywords.some((keyword) => lower.includes(keyword));
  };

  if (isSecretInsecure(data.JWT_SECRET)) {
    errors.push('Refusing to start in production with default/development JWT_SECRET.');
  }

  if (isSecretInsecure(data.WEBHOOK_SECRET)) {
    errors.push('Refusing to start in production with default/development WEBHOOK_SECRET.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

const secretCheck = validateProductionSecrets(parsed.data);
if (!secretCheck.valid) {
  console.error('❌  Production secret validation failed:');
  secretCheck.errors.forEach((err) => console.error(`   - ${err}`));
  process.exit(1);
}

export const env = parsed.data;
