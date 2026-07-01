'use strict';

const MAX_ENTRIES = 200;

/** @type {Array<object>} */
const entries = [];

function recordAirtelCallback({
  payload,
  merchantReference,
  statusCode,
  airtelMoneyId,
  normalizedStatus,
  verifiedStatus,
  verifiedStatusCode,
  error,
}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    merchantReference: merchantReference || null,
    statusCode: statusCode || null,
    airtelMoneyId: airtelMoneyId || null,
    normalizedStatus: normalizedStatus || null,
    verifiedStatus: verifiedStatus || null,
    verifiedStatusCode: verifiedStatusCode || null,
    error: error || null,
    payload: payload || null,
  };

  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  return entry;
}

function listAirtelCallbacks({ transactionId, limit = 50 } = {}) {
  const normalizedId = String(transactionId || '').trim().toUpperCase();
  const max = Math.min(Math.max(Number(limit) || 50, 1), MAX_ENTRIES);

  const filtered = normalizedId
    ? entries.filter((item) => String(item.merchantReference || '').toUpperCase() === normalizedId)
    : entries;

  return filtered.slice(0, max);
}

module.exports = {
  recordAirtelCallback,
  listAirtelCallbacks,
};
