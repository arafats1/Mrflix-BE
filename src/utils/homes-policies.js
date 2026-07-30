'use strict';

const CANCELLATION_POLICIES = {
  flexible: {
    value: 'flexible',
    label: 'Flexible',
    summary: 'Full refund if you cancel at least 24 hours before check-in. No refund within 24 hours of arrival.',
    details: [
      'Cancel 24+ hours before check-in → 100% refund',
      'Cancel within 24 hours of check-in → no refund',
      'No refund after check-in starts',
    ],
  },
  moderate: {
    value: 'moderate',
    label: 'Moderate',
    summary: 'Full refund if you cancel at least 5 days before check-in. 50% refund after that until check-in.',
    details: [
      'Cancel 5+ days before check-in → 100% refund',
      'Cancel less than 5 days before check-in → 50% refund',
      'No refund after check-in starts',
    ],
  },
  strict: {
    value: 'strict',
    label: 'Strict',
    summary: '50% refund if you cancel at least 7 days before check-in. No refund within 7 days of arrival.',
    details: [
      'Cancel 7+ days before check-in → 50% refund',
      'Cancel within 7 days of check-in → no refund',
      'No refund after check-in starts',
    ],
  },
};

function normalizeCancellationPolicy(value) {
  const key = String(value || 'moderate').toLowerCase();
  return CANCELLATION_POLICIES[key] ? key : 'moderate';
}

function getCancellationPolicyInfo(value) {
  const key = normalizeCancellationPolicy(value);
  return CANCELLATION_POLICIES[key];
}

function normalizeTimeOfDay(value, fallback = '14:00') {
  const raw = String(value || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':');
    const hour = Math.min(23, Math.max(0, Number(h)));
    const minute = Math.min(59, Math.max(0, Number(m)));
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  return fallback;
}

function parseCheckInDateTime(checkIn, checkInTime = '14:00') {
  const date = String(checkIn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(NaN);
  const time = normalizeTimeOfDay(checkInTime, '14:00');
  return new Date(`${date}T${time}:00`);
}

function hoursUntilCheckIn(checkIn, checkInTime = '14:00', now = new Date()) {
  const start = parseCheckInDateTime(checkIn, checkInTime);
  if (Number.isNaN(start.getTime())) return 0;
  return (start.getTime() - now.getTime()) / 3600000;
}

/** Whole calendar days from local "today" until the check-in date (0 = check-in is today). */
function calendarDaysUntilCheckIn(checkIn, now = new Date()) {
  const date = String(checkIn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const checkDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.round((checkDay.getTime() - today.getTime()) / 86400000);
}

function calculateCancellationRefund(policy, checkIn, amountUGX, now = new Date(), checkInTime = '14:00') {
  const amount = Math.max(0, Number(amountUGX || 0));
  const hours = hoursUntilCheckIn(checkIn, checkInTime, now);
  const days = calendarDaysUntilCheckIn(checkIn, now);
  const key = normalizeCancellationPolicy(policy);

  // After check-in time has passed — no refund.
  if (hours <= 0) return 0;

  if (key === 'flexible') {
    return hours >= 24 ? amount : 0;
  }
  if (key === 'moderate') {
    // Full refund only when cancelling 5+ calendar days before the check-in date.
    if (days >= 5) return amount;
    return Math.round(amount * 0.5);
  }
  // strict
  if (days >= 7) return Math.round(amount * 0.5);
  return 0;
}

function payoutEligibleAtFromCheckIn(checkIn, checkInTime = '14:00') {
  const start = parseCheckInDateTime(checkIn, checkInTime);
  if (Number.isNaN(start.getTime())) return null;
  start.setDate(start.getDate() + 1);
  return start.toISOString();
}

/** Confirmation opens 1 hour before the listing's check-in time. */
function isCheckInWindowOpen(checkIn, checkInTime = '14:00', now = new Date()) {
  const start = parseCheckInDateTime(checkIn, checkInTime);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() >= (start.getTime() - 60 * 60 * 1000);
}

/** Reminder card: from 2 hours before check-in, not on past check-in dates. */
function isCheckInReminderActive(checkIn, checkInTime = '14:00', now = new Date()) {
  const start = parseCheckInDateTime(checkIn, checkInTime);
  if (Number.isNaN(start.getTime())) return false;
  const checkInDate = String(checkIn || '').slice(0, 10);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  if (!checkInDate || checkInDate < today) return false;
  return now.getTime() >= (start.getTime() - 2 * 60 * 60 * 1000);
}

module.exports = {
  CANCELLATION_POLICIES,
  normalizeCancellationPolicy,
  getCancellationPolicyInfo,
  normalizeTimeOfDay,
  parseCheckInDateTime,
  hoursUntilCheckIn,
  calendarDaysUntilCheckIn,
  calculateCancellationRefund,
  payoutEligibleAtFromCheckIn,
  isCheckInWindowOpen,
  isCheckInReminderActive,
};
