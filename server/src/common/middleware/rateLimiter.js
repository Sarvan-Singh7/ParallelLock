/**
 * rateLimiter.js – Rate limiting middleware suite (R1)
 *
 * Requirements:
 * 1. HOLD LIMITER:
 *    - Keyed by `req.user.id` (mounted AFTER requireAuth).
 *    - Limit: 10 per minute (default).
 *    - Strict zero per-IP limit on holds, seat maps, catalog, or read routes (campus/NAT friendly).
 * 2. LOGIN LIMITER (Failed Attempts Only):
 *    - Only counts FAILED logins, never successful ones.
 *    - Dual keying:
 *      * `rl:login:fail:ip:<ip>`: 60 failures per 15 minutes (generous for shared NAT).
 *      * `rl:login:fail:email:<normalizedEmail>`: 10 failures per 15 minutes (brute-force barrier).
 *    - Successful login resets the email counter (`reset`).
 *    - 429 response for existing vs non-existing emails is byte-identical (prevents account enumeration).
 * 3. REGISTER LIMITER:
 *    - 30 per 10 minutes per IP.
 *    - Note: CAPTCHA is the recommended next defense layer for bot farms.
 * 4. HEADERS & 429 RESPONSE:
 *    - Sets Retry-After (seconds integer), X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset.
 *    - Never leaks internal keys or user emails.
 * 5. DEFAULTS & TEST OVERRIDE:
 *    - ON in production / dev.
 *    - OFF by default in test mode (`NODE_ENV === 'test'`) unless explicitly enabled by a test.
 */
import { env } from '../../config/env.js';
import { defaultRateLimitStore } from './rateLimitStore.js';

/**
 * Determine if rate limiting is enabled globally
 */
export function isRateLimiterEnabled() {
  if (process.env.ENABLE_RATE_LIMITER === 'false') return false;
  if (process.env.ENABLE_RATE_LIMITER === 'true') return true;
  if (process.env.NODE_ENV === 'test') return false;
  return true;
}

/**
 * Factory for standard sliding-window rate limit middleware
 */
export function createRateLimiter({
  store = defaultRateLimitStore,
  keyGenerator,
  limit,
  windowMs,
  isEnabled = isRateLimiterEnabled,
}) {
  return async function rateLimitMiddleware(req, res, next) {
    if (!isEnabled()) {
      return next();
    }

    const key = keyGenerator(req);
    if (!key) {
      return next();
    }

    const nowMs = store.now ? store.now() : Date.now();
    const { count, resetTimeMs } = await store.increment(key, windowMs);
    const remaining = Math.max(0, limit - count);
    const retryAfterSec = Math.max(1, Math.ceil((resetTimeMs - nowMs) / 1000));

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetTimeMs / 1000)));

    if (count > limit) {
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          details: {},
        },
      });
    }

    next();
  };
}

// ─── 1. Hold Rate Limiter (User ID Keyed) ────────────────────────────────────
// Mounted AFTER requireAuth so req.user.id is always available.
export function createHoldRateLimiter(options = {}) {
  const store = options.store || defaultRateLimitStore;
  const limit = options.limit || env.RATE_LIMIT_HOLDS_PER_MIN || 10;
  const windowMs = options.windowMs || 60_000; // 1 minute
  const isEnabled = options.isEnabled || isRateLimiterEnabled;

  return createRateLimiter({
    store,
    limit,
    windowMs,
    isEnabled,
    keyGenerator: (req) => (req.user?.id ? `rl:hold:user:${req.user.id}` : null),
  });
}

// ─── 2. Register Rate Limiter (IP Keyed) ─────────────────────────────────────
// Rate limit: 30 accounts per 10 minutes per IP.
// NOTE: CAPTCHA (e.g. Cloudflare Turnstile / reCAPTCHA) is the right next control
// for public registration endpoints to prevent automated farm signups.
export function createRegisterRateLimiter(options = {}) {
  const store = options.store || defaultRateLimitStore;
  const limit = options.limit || env.RATE_LIMIT_REGISTER_PER_10MIN || 30;
  const windowMs = options.windowMs || 600_000; // 10 minutes
  const isEnabled = options.isEnabled || isRateLimiterEnabled;

  return createRateLimiter({
    store,
    limit,
    windowMs,
    isEnabled,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      return `rl:register:ip:${ip}`;
    },
  });
}

// ─── 3. Login Rate Limiter (Failed-Attempts Only) ────────────────────────────
export const LOGIN_FAIL_IP_LIMIT = 60; // 60 failures / 15m (shared NAT friendly)
export const LOGIN_FAIL_EMAIL_LIMIT = 10; // 10 failures / 15m (anti-bruteforce)
export const LOGIN_WINDOW_MS = 900_000; // 15 minutes

export function getLoginFailKeys(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = String(req.body?.email || '').trim().toLowerCase();
  return {
    ipKey: `rl:login:fail:ip:${ip}`,
    emailKey: email ? `rl:login:fail:email:${email}` : null,
  };
}

/**
 * Pre-login middleware: checks if failed-attempt thresholds have been reached.
 * Never leaks whether the target email exists.
 */
export function createLoginPreCheckMiddleware(options = {}) {
  const store = options.store || defaultRateLimitStore;
  const isEnabled = options.isEnabled || isRateLimiterEnabled;
  const ipLimit = options.ipLimit || env.RATE_LIMIT_LOGIN_FAIL_IP_PER_15MIN || LOGIN_FAIL_IP_LIMIT;
  const emailLimit = options.emailLimit || env.RATE_LIMIT_LOGIN_FAIL_EMAIL_PER_15MIN || LOGIN_FAIL_EMAIL_LIMIT;

  return async function loginPreCheck(req, res, next) {
    if (!isEnabled()) {
      return next();
    }

    const { ipKey, emailKey } = getLoginFailKeys(req);
    const nowMs = store.now ? store.now() : Date.now();

    const ipData = await store.get(ipKey);
    const emailData = emailKey ? await store.get(emailKey) : { count: 0, resetTimeMs: nowMs };

    const ipLimited = ipData.count >= ipLimit;
    const emailLimited = emailData.count >= emailLimit;

    if (ipLimited || emailLimited) {
      // Pick the active limiter info (email takes precedence for Retry-After)
      const activeData = emailLimited ? emailData : ipData;
      const activeLimit = emailLimited ? emailLimit : ipLimit;
      const retryAfterSec = Math.max(1, Math.ceil((activeData.resetTimeMs - nowMs) / 1000));

      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(activeLimit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(activeData.resetTimeMs / 1000)));

      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          details: {},
        },
      });
    }

    next();
  };
}

/**
 * Record a login failure: increments failure counters for both IP and email
 */
export async function recordLoginFailure(req, store = defaultRateLimitStore) {
  const { ipKey, emailKey } = getLoginFailKeys(req);
  await store.increment(ipKey, LOGIN_WINDOW_MS);
  if (emailKey) {
    await store.increment(emailKey, LOGIN_WINDOW_MS);
  }
}

/**
 * Record a login success: resets the failure counter for the email
 */
export async function recordLoginSuccess(req, store = defaultRateLimitStore) {
  const { emailKey } = getLoginFailKeys(req);
  if (emailKey) {
    await store.reset(emailKey);
  }
}

// Export default instances for route attachment
export const holdRateLimiter = createHoldRateLimiter();
export const registerRateLimiter = createRegisterRateLimiter();
export const loginRateLimiter = createLoginPreCheckMiddleware();
