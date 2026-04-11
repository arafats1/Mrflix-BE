'use strict';

/**
 * DGateway Payment Integration Utility
 *
 * Uses DGateway REST API.
 * Docs: https://dgateway.desispay.com/docs
 *
 * Flow:
 *   1. collectPayment() – initiate a mobile money collection
 *   2. verifyTransaction() – check transaction status by reference
 */

const API_URL = process.env.DGATEWAY_API_URL || 'https://dgatewayapi.desispay.com';
const API_KEY = process.env.DGATEWAY_API_KEY;

/**
 * Internal helper — makes authenticated requests to DGateway API.
 */
async function dgw(path, options = {}) {
  if (!API_KEY) {
    throw new Error('DGATEWAY_API_KEY environment variable is not set');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || 'DGateway API error');
  }
  return json;
}

/**
 * Collect a payment (mobile money prompt sent to user's phone).
 *
 * @param {object} params
 * @param {number} params.amount – amount in UGX
 * @param {string} params.currency – e.g. "UGX"
 * @param {string} params.phone_number – e.g. "256700000000"
 * @param {string} [params.provider] – e.g. "iotec"
 * @param {string} [params.description] – what the user is paying for
 * @param {object} [params.metadata] – arbitrary metadata
 * @returns {{ data: { reference, status, ... } }}
 */
async function collectPayment(params) {
  return dgw('/v1/payments/collect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * Verify a transaction status by reference.
 * Unlike collectPayment, this does NOT throw on API errors — it returns
 * the response as-is so the caller can handle pending/error states gracefully.
 *
 * @param {string} reference – the transaction reference from collectPayment
 * @returns {{ data?: { reference, status, amount, failure_reason, ... }, error?: { code, message } }}
 */
async function verifyTransaction(reference) {
  if (!API_KEY) {
    throw new Error('DGATEWAY_API_KEY environment variable is not set');
  }

  const res = await fetch(`${API_URL}/v1/webhooks/verify`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reference }),
  });

  return res.json();
}

module.exports = {
  collectPayment,
  verifyTransaction,
};
