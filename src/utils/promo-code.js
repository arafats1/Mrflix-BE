'use strict';

const UID = 'api::promo-code.promo-code';

function normalizeCode(raw) {
  return (raw || '').toString().trim().toUpperCase();
}

// Validate a promo code without going through HTTP. Returns
// { ok: true, record } on success, { ok: false, reason } on failure.
async function evaluatePromoCode(strapi, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: 'Promo code is required' };

  const matches = await strapi.entityService.findMany(UID, {
    filters: { code },
    limit: 1,
  });
  const record = matches && matches[0];
  if (!record) return { ok: false, reason: 'Promo code not found' };
  if (!record.isActive) return { ok: false, reason: 'Promo code is disabled' };

  const now = new Date();
  if (record.validFrom && new Date(record.validFrom) > now) {
    return { ok: false, reason: 'Promo code is not active yet' };
  }
  if (record.validUntil && new Date(record.validUntil) < now) {
    return { ok: false, reason: 'Promo code has expired' };
  }
  if (record.maxUses && record.maxUses > 0 && (record.usedCount || 0) >= record.maxUses) {
    return { ok: false, reason: 'Promo code usage limit reached' };
  }

  return { ok: true, record };
}

// Atomically (-ish) bump the usedCount by 1 after successful checkout.
async function incrementPromoUsage(strapi, recordOrId) {
  const id = typeof recordOrId === 'object' ? recordOrId?.id : recordOrId;
  if (!id) return;
  try {
    const fresh = await strapi.entityService.findOne(UID, id);
    if (!fresh) return;
    await strapi.entityService.update(UID, id, {
      data: { usedCount: (fresh.usedCount || 0) + 1 },
    });
  } catch (err) {
    strapi.log.error('[promo-code] Failed to increment usedCount', err?.message || err);
  }
}

module.exports = { evaluatePromoCode, incrementPromoUsage, normalizeCode };
