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

function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readResponseBody(res) {
  const text = await res.text();
  const data = parseMaybeJson(text);
  return { text, data };
}

function createDGatewayError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

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

  const { text, data } = await readResponseBody(res);

  if (!data) {
    throw createDGatewayError(
      `DGateway returned a non-JSON response (${res.status} ${res.statusText})`,
      {
        status: res.status,
        statusText: res.statusText,
        rawBody: text,
        code: 'DGATEWAY_NON_JSON_RESPONSE',
      }
    );
  }

  if (!res.ok) {
    throw createDGatewayError(
      data.error?.message || data.message || 'DGateway API error',
      {
        status: res.status,
        statusText: res.statusText,
        response: data,
        code: data.error?.code || 'DGATEWAY_API_ERROR',
      }
    );
  }
  return data;
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

  const { text, data } = await readResponseBody(res);
  if (data) return data;

  return {
    error: {
      code: 'DGATEWAY_NON_JSON_RESPONSE',
      message: `DGateway verify returned a non-JSON response (${res.status} ${res.statusText})`,
      status: res.status,
      rawBody: text,
    },
  };
}

async function listTransactions(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.perPage) query.set('per_page', String(params.perPage));
  if (params.status) query.set('status', params.status);

  const path = `/v1/payments/transactions${query.toString() ? `?${query.toString()}` : ''}`;
  return dgw(path, { method: 'GET' });
}

function normalizeMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'object') return metadata;
  if (typeof metadata === 'string') return parseMaybeJson(metadata);
  return null;
}

async function findTransactionByMerchantReference(merchantReference, options = {}) {
  if (!merchantReference) return null;

  const result = await listTransactions({
    page: 1,
    perPage: options.perPage || 50,
    status: options.status || 'all',
  });

  const transactions = Array.isArray(result?.data) ? result.data : [];

  return transactions.find((transaction) => {
    const metadata = normalizeMetadata(transaction?.metadata);
    return metadata?.merchant_reference === merchantReference;
  }) || null;
}

module.exports = {
  collectPayment,
  verifyTransaction,
  listTransactions,
  findTransactionByMerchantReference,
};
