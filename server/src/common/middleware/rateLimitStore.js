/**
 * rateLimitStore.js – Pluggable RateLimitStore Interface & In-Memory Implementation (R1)
 *
 * Requirements:
 * 1. Interface: get(key), increment(key, windowMs), reset(key)
 * 2. Atomic increment: synchronous execution in Node.js event loop with no async gaps between read & write.
 * 3. Injectable clock (now()): allows fast, deterministic tests without sleeping.
 * 4. Automatic memory bounds: maxKeys (default 100,000) with oldest-first (LRU) eviction so rotating keys cannot exhaust RAM.
 * 5. Expired keys evicted periodically via an unref()'d timer.
 *
 * NOTE FOR INTERVIEWS & PRODUCTION:
 * This in-memory store is strictly process-local. In a multi-instance horizontal deployment
 * (e.g., behind a load balancer on Render or Kubernetes), a Redis-backed implementation
 * implementing this exact RateLimitStore interface must be used to share rate-limit state.
 */

export class RateLimitStore {
  /**
   * Get current rate limit status for key
   * @param {string} key
   * @returns {Promise<{ count: number, resetTimeMs: number }>}
   */
  async get(key) {
    throw new Error('RateLimitStore.get must be implemented');
  }

  /**
   * Atomically increment request counter for key
   * @param {string} key
   * @param {number} windowMs
   * @returns {Promise<{ count: number, resetTimeMs: number }>}
   */
  async increment(key, windowMs) {
    throw new Error('RateLimitStore.increment must be implemented');
  }

  /**
   * Reset rate limit bucket for key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async reset(key) {
    throw new Error('RateLimitStore.reset must be implemented');
  }
}

export class InMemoryRateLimitStore extends RateLimitStore {
  /**
   * @param {object} options
   * @param {function} [options.now] Injectable clock function returning epoch ms
   * @param {number} [options.maxKeys] Maximum stored keys before LRU eviction (default 100,000)
   * @param {number} [options.cleanupIntervalMs] Interval to purge expired entries (default 60,000 ms)
   */
  constructor({
    now = () => Date.now(),
    maxKeys = 100_000,
    cleanupIntervalMs = 60_000,
  } = {}) {
    super();
    this.now = now;
    this.maxKeys = maxKeys;
    // Map retains insertion order in JS, enabling O(1) LRU eviction
    this.hits = new Map();

    // Expired keys cleanup timer (unref'd so it does not block Node process exit)
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    if (this.cleanupTimer?.unref) {
      this.cleanupTimer.unref();
    }
  }

  async get(key) {
    const entry = this.hits.get(key);
    const currentTime = this.now();

    if (!entry || entry.resetTimeMs <= currentTime) {
      if (entry) this.hits.delete(key);
      return { count: 0, resetTimeMs: currentTime };
    }

    // Refresh LRU order on access
    this.hits.delete(key);
    this.hits.set(key, entry);

    return { count: entry.count, resetTimeMs: entry.resetTimeMs };
  }

  async increment(key, windowMs) {
    const currentTime = this.now();
    let entry = this.hits.get(key);

    if (!entry || entry.resetTimeMs <= currentTime) {
      // Window expired or new key: start fresh bucket
      entry = {
        count: 1,
        resetTimeMs: currentTime + windowMs,
      };
    } else {
      // Window still valid: increment counter atomically
      entry.count += 1;
    }

    // Re-insert to keep MRU order at the end of the Map
    this.hits.delete(key);

    // Evict oldest entry if at maximum capacity
    if (this.hits.size >= this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey) this.hits.delete(oldestKey);
    }

    this.hits.set(key, entry);

    return { count: entry.count, resetTimeMs: entry.resetTimeMs };
  }

  async reset(key) {
    this.hits.delete(key);
  }

  cleanup() {
    const currentTime = this.now();
    for (const [key, entry] of this.hits.entries()) {
      if (entry.resetTimeMs <= currentTime) {
        this.hits.delete(key);
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.hits.clear();
  }
}

// Default singleton store shared across route limiters
export const defaultRateLimitStore = new InMemoryRateLimitStore();
