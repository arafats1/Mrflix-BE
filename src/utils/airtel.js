'use strict';

/**
 * Airtel Money Collections API utility.
 *
 * Docs: https://developers.airtel.africa/documentation/collection-apis/2.0
 *
 * Flow:
 *   1. getAccessToken() – OAuth2 client credentials
 *   2. requestCollection() – initiate USSD push collection (used by payment gateway)
 *   3. getTransactionStatus() – verify payment status (callback + polling)
 */

const AIRTEL_ENV = String(process.env.AIRTEL_ENV || 'sandbox').trim().toLowerCase();
const BASE_URL = AIRTEL_ENV === 'production'
  ? 'https://openapi.airtel.africa'
  : 'https://openapiuat.airtel.africa';

function readEnv(name) {
  return String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

const CLIENT_ID = readEnv('AIRTEL_CLIENT_ID');
const CLIENT_SECRET = readEnv('AIRTEL_CLIENT_SECRET');
const COUNTRY = readEnv('AIRTEL_COUNTRY') || 'UG';
const CURRENCY = readEnv('AIRTEL_CURRENCY') || 'UGX';

let cachedToken = null;
let tokenExpiry = 0;

function extractAirtelErrorMessage(data, fallback = 'Airtel request failed.') {
  if (!data || typeof data !== 'object') return fallback;

  return (
    data.message
    || data.error_description
    || data.error
    || data.status?.message
    || data.status?.response_message
    || (typeof data.status === 'string' ? data.status : null)
    || fallback
  );
}

function createAirtelError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function getCallbackUrl() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL is required to register Airtel callback URLs.');
  }

  return new URL('/api/airtel/callback', process.env.PUBLIC_URL).toString();
}

function getApiHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'X-Country': COUNTRY,
    'X-Currency': CURRENCY,
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Normalize Airtel transaction status codes.
 * TS = success, TF = failed, TIP = in progress, TA = ambiguous.
 */
function normalizeAirtelStatus(statusCode) {
  const code = String(statusCode || '').toUpperCase();

  if (code === 'TS') return 'completed';
  if (code === 'TF') return 'failed';
  return 'pending';
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw createAirtelError('AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET are required.');
  }

  const res = await fetch(`${BASE_URL}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    const message = extractAirtelErrorMessage(data, 'Failed to authenticate with Airtel.');
    throw createAirtelError(message, {
      status: res.status,
      code: data.status_code || data.status?.code,
      raw: data,
      hint: !CLIENT_ID || !CLIENT_SECRET
        ? 'Set AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET on the server (Railway), then redeploy.'
        : `Verify credentials match ${AIRTEL_ENV} mode in the Airtel portal and whitelist Railway outbound IPs.`,
    });
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

/**
 * Initiate a collection (USSD push) payment.
 *
 * @param {object} params
 * @param {string} params.merchantReference – unique transaction id (PUR_, SUB_, etc.)
 * @param {number} params.amount
 * @param {string} params.phone – subscriber msisdn (local or international)
 * @param {string} [params.reference] – optional human-readable reference
 */
async function requestCollection({ merchantReference, amount, phone, reference }) {
  const accessToken = await getAccessToken();
  const msisdn = String(phone || '').replace(/\D/g, '').replace(/^256/, '');

  const res = await fetch(`${BASE_URL}/merchant/v1/payments/`, {
    method: 'POST',
    headers: getApiHeaders(accessToken),
    body: JSON.stringify({
      reference: reference || merchantReference,
      subscriber: {
        country: COUNTRY,
        currency: CURRENCY,
        msisdn,
      },
      transaction: {
        amount: Number(amount),
        country: COUNTRY,
        currency: CURRENCY,
        id: merchantReference,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw createAirtelError(extractAirtelErrorMessage(data, 'Airtel collection request failed.'), {
      status: res.status,
      code: data.status?.code || data.status_code,
      raw: data,
    });
  }

  return data;
}

/**
 * Fetch transaction status from Airtel.
 *
 * @param {string} transactionId – merchant transaction id used when initiating payment
 */
async function getTransactionStatus(transactionId) {
  const accessToken = await getAccessToken();

  const res = await fetch(`${BASE_URL}/standard/v1/payments/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    headers: getApiHeaders(accessToken),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw createAirtelError(data.message || 'Failed to fetch Airtel transaction status.', {
      status: res.status,
      code: data.status?.code || data.status_code,
      raw: data,
    });
  }

  const transaction = data?.data?.transaction || data?.transaction || {};
  const statusCode = transaction.status || transaction.status_code || '';

  return {
    status: normalizeAirtelStatus(statusCode),
    statusCode,
    message: transaction.message || '',
    airtelMoneyId: transaction.airtel_money_id || '',
    transactionId: transaction.id || transactionId,
    raw: data,
  };
}

module.exports = {
  getCallbackUrl,
  getAccessToken,
  requestCollection,
  getTransactionStatus,
  normalizeAirtelStatus,
};
