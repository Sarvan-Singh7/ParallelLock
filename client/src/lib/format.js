/**
 * format.js – Formatting helpers for currency, dates, and times
 */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Converts price in minor units (paise / cents) to formatted INR string (e.g. ₹320).
 */
export function formatCurrency(priceCents) {
  if (typeof priceCents !== 'number') return '₹0';
  return inrFormatter.format(priceCents / 100);
}

/**
 * Formats ISO timestamp to local time string in Asia/Kolkata (e.g. "10:30 AM").
 */
export function formatShowTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Formats date string to friendly day in Asia/Kolkata (e.g. "Today, 26 Oct" or "Tue, 27 Oct").
 */
export function formatShowDate(dateStr) {
  if (!dateStr) return '';
  // Accept ISO timestamp or YYYY-MM-DD
  const datePart = dateStr.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const tomorrow = new Date(today.getTime() + 86400000);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  let prefix = '';
  if (datePart === todayStr) prefix = 'Today, ';
  else if (datePart === tomorrowStr) prefix = 'Tomorrow, ';

  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: prefix ? undefined : 'short',
    day: 'numeric',
    month: 'short',
  }).format(targetDate);

  return `${prefix}${formatted}`;
}

/**
 * Full date and time formatter for tickets (e.g. "Mon, 26 Oct 2026 at 10:30 AM").
 */
export function formatFullDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}
