'use strict';

function normalizePhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  if (!raw) return '';

  let normalized = raw.replace(/[\s()+-]/g, '');
  if (normalized.startsWith('0')) normalized = `256${normalized.slice(1)}`;
  return normalized;
}

function looksLikePhone(identifier) {
  const normalized = normalizePhone(identifier);
  return /^\d{9,15}$/.test(normalized);
}

function getPhoneLookupVariants(identifier) {
  const normalized = normalizePhone(identifier);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (normalized.startsWith('256') && normalized.length >= 12) {
    variants.add(`0${normalized.slice(3)}`);
  }
  if (normalized.startsWith('0') && normalized.length >= 10) {
    variants.add(`256${normalized.slice(1)}`);
  }

  return [...variants];
}

function buildSyntheticPhoneEmail(normalizedPhone) {
  return normalizedPhone ? `${normalizedPhone}@phone.movokids.local` : '';
}

/**
 * Resolve a local user from a phone-style login identifier.
 * Handles 07xx / 256xx formats and legacy rows where phone was stored inconsistently.
 */
async function findUserByPhoneIdentifier(strapi, identifier, { requireParent = false } = {}) {
  const trimmed = String(identifier || '').trim();
  if (!trimmed || !looksLikePhone(trimmed)) return null;

  const normalized = normalizePhone(trimmed);
  const variants = getPhoneLookupVariants(trimmed);
  const syntheticEmail = buildSyntheticPhoneEmail(normalized);

  const baseWhere = requireParent ? { isParent: true } : {};

  const directMatch = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: {
      ...baseWhere,
      $or: [
        ...variants.map((phone) => ({ phone })),
        ...(syntheticEmail ? [{ email: syntheticEmail }] : []),
      ],
    },
    select: ['id', 'email', 'username', 'phone', 'blocked', 'confirmed', 'provider', 'isParent'],
  });

  if (directMatch) return directMatch;

  const candidates = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: {
      ...baseWhere,
      phone: { $notNull: true },
    },
    select: ['id', 'email', 'username', 'phone', 'blocked', 'confirmed', 'provider', 'isParent'],
    limit: 25000,
  });

  return candidates.find((entry) => normalizePhone(entry.phone) === normalized) || null;
}

function isInvalidCredentialsError(error) {
  const message = String(error?.message || '');
  return /invalid identifier or password/i.test(message);
}

module.exports = {
  normalizePhone,
  looksLikePhone,
  getPhoneLookupVariants,
  buildSyntheticPhoneEmail,
  findUserByPhoneIdentifier,
  isInvalidCredentialsError,
};
