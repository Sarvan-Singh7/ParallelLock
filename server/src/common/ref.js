/**
 * ref.js – Booking reference generator
 *
 * ref = 'PL-' + 8 random characters from ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 * using crypto.randomInt (unguessable, non-sequential).
 */
import crypto from 'node:crypto';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateBookingRef() {
  let str = '';
  for (let i = 0; i < 8; i++) {
    const idx = crypto.randomInt(0, CHARS.length);
    str += CHARS[idx];
  }
  return `PL-${str}`;
}
