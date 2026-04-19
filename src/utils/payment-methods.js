'use strict';

const ALLOWED_PAYMENT_METHODS = new Set([
  'mtn_momo',
  'airtel_money',
  'pesapal',
  'dgateway',
  'admin_granted',
  'free_trial',
  'referral_referred',
  'referral_referrer',
]);

function normalizePaymentMethod(rawMethod, fallbackMethod = '') {
  const raw = typeof rawMethod === 'string' ? rawMethod.trim() : '';
  const fallback = typeof fallbackMethod === 'string' ? fallbackMethod.trim() : '';

  if (!raw && !fallback) return '';

  const lowered = raw.toLowerCase();
  const compact = lowered.replace(/[^a-z0-9]/g, '');
  const normalizedFallback = fallback.toLowerCase();

  if (ALLOWED_PAYMENT_METHODS.has(lowered)) return lowered;

  if (compact.includes('airtel')) return 'airtel_money';
  if (compact.includes('mtn')) return 'mtn_momo';

  if (compact.includes('pesapal')) return 'pesapal';
  if (compact.includes('dgateway') || compact.includes('iotec')) return 'dgateway';

  if (ALLOWED_PAYMENT_METHODS.has(normalizedFallback)) return normalizedFallback;

  return '';
}

module.exports = {
  ALLOWED_PAYMENT_METHODS,
  normalizePaymentMethod,
};