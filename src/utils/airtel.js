'use strict';

/**
 * Airtel Money Collections API utility.
 *
 * Uganda (UG) uses country-specific hosts:
 *   - Sandbox: https://openapiuat.airtel.ug
 *   - Production: https://openapi.airtel.ug
 *
 * Message signing (v2 + x-signature/x-key) is optional and must stay OFF until
 * Airtel confirms it is live. Default collections use unsigned /merchant/v1/payments/.
 *
 * Other Op-Cos default to the Africa hosts unless AIRTEL_BASE_URL is set.
 */

const { formatPublicKeyPem, signJsonPayload, resolveEncryptedPin, isPreEncryptedPin } = require('./airtel-crypto');
const { classifyAirtelStatus, describeAirtelResponseCode } = require('./airtel-response-codes');

const AIRTEL_ENV = String(process.env.AIRTEL_ENV || 'sandbox').trim().toLowerCase();

function readEnv(name) {
  return String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

const CLIENT_ID = readEnv('AIRTEL_CLIENT_ID');
const CLIENT_SECRET = readEnv('AIRTEL_CLIENT_SECRET');
const COUNTRY = readEnv('AIRTEL_COUNTRY') || 'UG';
const CURRENCY = readEnv('AIRTEL_CURRENCY') || 'UGX';
const DEFAULT_DISBURSEMENT_TRANSACTION_TYPE = readEnv('AIRTEL_DISBURSEMENT_TRANSACTION_TYPE') || 'B2C';

function resolveBaseUrl() {
  const override = readEnv('AIRTEL_BASE_URL');
  if (override) return override.replace(/\/$/, '');

  if (COUNTRY === 'UG') {
    return AIRTEL_ENV === 'production'
      ? 'https://openapi.airtel.ug'
      : 'https://openapiuat.airtel.ug';
  }

  return AIRTEL_ENV === 'production'
    ? 'https://openapi.airtel.africa'
    : 'https://openapiuat.airtel.africa';
}

function resolveApiVersion() {
  const configured = readEnv('AIRTEL_API_VERSION');
  if (configured) return configured;
  // Default unsigned v1 until Airtel enables message signing in production.
  return '1';
}

const BASE_URL = resolveBaseUrl();
const API_VERSION = resolveApiVersion();

let cachedToken = null;
let tokenExpiry = 0;
let cachedRsaKey = null;
let cachedRsaKeyMaterial = null;
let cachedRsaPinKeyMaterial = null;
let cachedRsaKeyExpiry = 0;

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

/**
 * New collections callback URL (Airtel docs: Callback With/Without Authentication).
 * Register this in the Airtel developer portal Application settings.
 */
function getCollectionsCallbackUrl() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL is required to register Airtel callback URLs.');
  }

  return new URL('/api/airtel/collections/callback', process.env.PUBLIC_URL).toString();
}

function getApiHeaders(accessToken, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'X-Country': COUNTRY,
    'X-Currency': CURRENCY,
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

/**
 * Normalize Airtel transaction status codes / response codes.
 * v1: TS / TF / TIP / TA
 * v2: SUCCESS / FAILED / etc.
 * Enquiry: DP00800001001 (success), DP00800001002 (wrong pin), DP00800001003 (over limit), ...
 */
function normalizeAirtelStatus(statusCode) {
  return classifyAirtelStatus(statusCode);
}

/**
 * Resolve the best available status signal from an Airtel payload.
 * Prefers transaction.status / status_code, then status.response_code.
 */
function resolveStatusFromAirtelPayload(raw = {}) {
  const transaction = raw?.data?.transaction || raw?.transaction || {};
  const status = raw?.status || {};
  const statusCode = transaction.status || transaction.status_code || status.code || raw.status_code || null;
  const responseCode = status.response_code || raw.status_code || null;

  const fromStatus = statusCode ? normalizeAirtelStatus(statusCode) : null;
  const fromResponse = responseCode ? normalizeAirtelStatus(responseCode) : null;

  // Prefer an explicit terminal signal from either field.
  let normalized = 'pending';
  if (fromStatus === 'completed' || fromResponse === 'completed') {
    normalized = 'completed';
  } else if (fromStatus === 'failed' || fromResponse === 'failed') {
    normalized = 'failed';
  } else if (fromStatus === 'pending' || fromResponse === 'pending') {
    normalized = 'pending';
  }

  const message = transaction.message
    || status.message
    || describeAirtelResponseCode(responseCode)
    || raw.status_message
    || '';

  return {
    status: normalized,
    statusCode,
    responseCode,
    message,
    airtelMoneyId: transaction.airtel_money_id || '',
    transactionId: transaction.id || null,
  };
}

async function requestAccessToken() {
  const res = await fetch(`${BASE_URL}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  const text = await res.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      message: text.includes('503') || res.status === 503
        ? 'Airtel sandbox is temporarily unavailable (503). Retry later or contact Airtel support.'
        : text.slice(0, 200) || `Non-JSON response from Airtel (HTTP ${res.status}).`,
      response_text: text.slice(0, 500),
    };
  }

  return { res, data };
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw createAirtelError('AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET are required.');
  }

  const { res, data } = await requestAccessToken();

  if (!res.ok || !data.access_token) {
    const message = extractAirtelErrorMessage(data, 'Failed to authenticate with Airtel.');
    throw createAirtelError(message, {
      status: res.status,
      code: data.status_code || data.status?.code,
      raw: data,
      hint: `Use Uganda host ${BASE_URL} for UG credentials. clientIdPrefix=${CLIENT_ID.slice(0, 8)} secretLength=${CLIENT_SECRET.length} env=${AIRTEL_ENV} apiVersion=${API_VERSION}`,
    });
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

async function getRsaPublicKey(accessToken) {
  if (cachedRsaKey && Date.now() < cachedRsaKeyExpiry) {
    return cachedRsaKey;
  }

  const res = await fetch(`${BASE_URL}/v1/rsa/encryption-keys`, {
    method: 'GET',
    headers: getApiHeaders(accessToken),
  });

  const data = await res.json().catch(() => ({}));
  const keyData = data?.data || data;
  const keyMaterial = keyData?.key || data?.key;
  const pinKeyMaterial = keyData?.pin_key || keyData?.pinKey || null;

  if (!res.ok || !keyMaterial) {
    throw createAirtelError(extractAirtelErrorMessage(data, 'Failed to fetch Airtel encryption key.'), {
      status: res.status,
      code: data.status_code || data.status?.code || data?.status?.response_code,
      raw: data,
      hint: `GET ${BASE_URL}/v1/rsa/encryption-keys failed. env=${AIRTEL_ENV} country=${COUNTRY} apiVersion=${API_VERSION}. ROUTER119 usually means Airtel rejected the call (wrong env/credentials/IP whitelist) or their key service is down.`,
    });
  }

  cachedRsaKeyMaterial = keyMaterial;
  cachedRsaPinKeyMaterial = pinKeyMaterial;
  cachedRsaKey = formatPublicKeyPem(keyMaterial);
  cachedRsaKeyExpiry = Date.now() + (12 * 60 * 60 * 1000);
  return cachedRsaKey;
}

async function getPinKeyMaterial(accessToken) {
  const override = readEnv('AIRTEL_PIN_PUBLIC_KEY');
  if (override) return override;

  await getRsaPublicKey(accessToken);
  return cachedRsaPinKeyMaterial || cachedRsaKeyMaterial;
}

function shouldSignDisbursement(override) {
  if (override === true) return true;
  if (override === false) return false;

  const configured = readEnv('AIRTEL_DISBURSEMENT_SIGNED');
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  // Uganda disbursement docs list x-signature/x-key as optional.
  // Signed collection works; signed disbursement often triggers ROUTER116 PIN decrypt errors.
  return false;
}

/**
 * Collections message signing (AES payload + RSA x-key) — OFF until Airtel says it is live.
 * Set AIRTEL_COLLECTION_SIGNED=true to use /merchant/v2/payments/ with x-signature/x-key.
 */
function shouldSignCollection() {
  const configured = readEnv('AIRTEL_COLLECTION_SIGNED');
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  // Explicit API v2 alone used to imply signing; keep that opt-in via AIRTEL_COLLECTION_SIGNED.
  return false;
}

async function postDisbursementRequest(accessToken, payload, signRequest) {
  if (shouldSignDisbursement(signRequest)) {
    return postSignedJsonRequest(accessToken, '/standard/v2/disbursements/', payload);
  }

  const res = await fetch(`${BASE_URL}/standard/v2/disbursements/`, {
    method: 'POST',
    headers: getApiHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function getRsaKeyMaterial(accessToken) {
  await getRsaPublicKey(accessToken);
  return cachedRsaKeyMaterial;
}

function buildCollectionPayload({ merchantReference, amount, phone, reference }) {
  const msisdn = normalizeMsisdn(phone);
  const transactionId = sanitizeAirtelReference(merchantReference, 'COL');
  const paymentReference = sanitizeAirtelReference(reference || `MOVO${transactionId.slice(-12)}`, transactionId);

  return {
    reference: paymentReference,
    subscriber: {
      country: COUNTRY,
      currency: CURRENCY,
      msisdn,
    },
    transaction: {
      // Keep non-integers as-is so UAT decimal-amount cases reach Airtel for rejection.
      amount: normalizeCollectionAmount(amount),
      country: COUNTRY,
      currency: CURRENCY,
      id: transactionId,
    },
  };
}

function normalizeCollectionAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (!Number.isInteger(n)) return n;
  return Math.trunc(n);
}

function buildDisbursementPayload({
  merchantReference,
  amount,
  phone,
  pin,
  payeeName,
  reference,
  transactionType,
}) {
  const msisdn = normalizeMsisdn(phone);
  const transactionId = sanitizeAirtelReference(merchantReference, 'DIS');

  return {
    payee: {
      currency: CURRENCY,
      msisdn,
      ...(payeeName ? { name: payeeName } : {}),
    },
    reference: sanitizeAirtelReference(reference || merchantReference, transactionId),
    pin,
    transaction: {
      amount: normalizeCollectionAmount(amount),
      id: transactionId,
      type: transactionType || DEFAULT_DISBURSEMENT_TRANSACTION_TYPE,
    },
  };
}

function toApiResult({ res, data }) {
  const transaction = data?.data?.transaction || {};
  const status = data?.status || {};

  return {
    ok: Boolean(res.ok),
    httpStatus: res.status,
    statusCode: transaction.status || status.code || data.status_code || null,
    message: status.message || transaction.message || data.status_message || data.message || '',
    airtelMoneyId: transaction.airtel_money_id || '',
    transactionId: transaction.id || '',
    raw: data,
  };
}

function normalizeMsisdn(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^256/, '');
}

/**
 * Airtel requires alphanumeric references/transaction IDs (4-64 chars).
 */
function sanitizeAirtelReference(value, fallback = 'TXN') {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 64);
  if (cleaned.length >= 4) return cleaned;

  const suffix = Date.now().toString(36).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const merged = `${fallback}${suffix}`.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 64);
  return merged.length >= 4 ? merged : `TXN${suffix}`.slice(0, 64);
}

function buildAirtelReference(prefix, parts = []) {
  const raw = [prefix, ...parts, Date.now().toString(36), Math.random().toString(36).slice(2, 8)]
    .filter(Boolean)
    .join('');
  return sanitizeAirtelReference(raw, String(prefix || 'TXN').replace(/[^a-zA-Z0-9]/g, '') || 'TXN');
}

async function postSignedJsonRequest(accessToken, path, payload) {
  const keyMaterial = await getRsaKeyMaterial(accessToken);
  const signed = signJsonPayload(keyMaterial, payload);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: getApiHeaders(accessToken, {
      'x-signature': signed.xSignature,
      'x-key': signed.xKey,
    }),
    body: signed.body,
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function postCollectionRequest(accessToken, payload) {
  if (shouldSignCollection()) {
    return postSignedJsonRequest(accessToken, '/merchant/v2/payments/', payload);
  }

  const res = await fetch(`${BASE_URL}/merchant/v1/payments/`, {
    method: 'POST',
    headers: getApiHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function testConnection() {
  const collectionSigned = shouldSignCollection();
  const config = {
    env: AIRTEL_ENV,
    baseUrl: BASE_URL,
    apiVersion: API_VERSION,
    collectionSigned,
    country: COUNTRY,
    currency: CURRENCY,
    clientIdConfigured: Boolean(CLIENT_ID),
    clientIdPrefix: CLIENT_ID ? `${CLIENT_ID.slice(0, 8)}...` : null,
    secretConfigured: Boolean(CLIENT_SECRET),
    secretLength: CLIENT_SECRET ? CLIENT_SECRET.length : 0,
    callbackUrl: process.env.PUBLIC_URL ? getCallbackUrl() : null,
    collectionsCallbackUrl: process.env.PUBLIC_URL ? getCollectionsCallbackUrl() : null,
  };

  try {
    const token = await getAccessToken();
    if (collectionSigned) {
      await getRsaPublicKey(token);
    }
    return {
      ...config,
      auth: 'ok',
      encryption: collectionSigned ? 'ok' : 'not_required',
    };
  } catch (error) {
    return {
      ...config,
      auth: 'failed',
      error: error.message,
      status: error.status || null,
      raw: error.raw || null,
      hint: error.hint || null,
    };
  }
}

/**
 * Initiate a collection (USSD push) payment.
 */
async function requestCollection({ merchantReference, amount, phone, reference }) {
  const result = await invokeCollection({ merchantReference, amount, phone, reference });

  if (!result.ok) {
    throw createAirtelError(result.message || 'Airtel collection request failed.', {
      status: result.httpStatus,
      code: result.raw?.status?.code || result.raw?.status_code,
      raw: result.raw,
    });
  }

  const resolved = resolveStatusFromAirtelPayload(result.raw);
  if (resolved.status === 'failed') {
    throw createAirtelError(
      resolved.message || extractAirtelErrorMessage(result.raw, 'Airtel collection was rejected.'),
      {
        status: result.httpStatus,
        code: resolved.responseCode || resolved.statusCode,
        raw: result.raw,
      }
    );
  }

  return result.raw;
}

/**
 * Raw collection call for UAT — returns Airtel response without throwing.
 */
async function invokeCollection({ merchantReference, amount, phone, reference }) {
  const accessToken = await getAccessToken();
  const payload = buildCollectionPayload({ merchantReference, amount, phone, reference });
  const response = await postCollectionRequest(accessToken, payload);
  return { ...toApiResult(response), payload };
}

/**
 * KYC / user enquiry for a subscriber MSISDN.
 */
async function enquireUser(msisdn) {
  const result = await invokeUserEnquiry(msisdn);

  if (!result.ok) {
    throw createAirtelError(result.message || 'Airtel user enquiry failed.', {
      status: result.httpStatus,
      code: result.raw?.status?.response_code || result.raw?.status?.code,
      raw: result.raw,
    });
  }

  return result.raw;
}

async function invokeUserEnquiry(msisdn) {
  const accessToken = await getAccessToken();
  const normalized = normalizeMsisdn(msisdn);

  const res = await fetch(`${BASE_URL}/standard/v1/users/${encodeURIComponent(normalized)}`, {
    method: 'GET',
    headers: getApiHeaders(accessToken),
  });

  const data = await res.json().catch(() => ({}));
  return toApiResult({ res, data });
}

/**
 * Disburse funds to an Airtel Money wallet.
 */
async function requestDisbursement({
  merchantReference,
  amount,
  phone,
  pin,
  payeeName,
  reference,
  transactionType,
}) {
  const result = await invokeDisbursement({
    merchantReference,
    amount,
    phone,
    pin,
    payeeName,
    reference,
    transactionType,
  });

  if (!result.ok) {
    throw createAirtelError(result.message || 'Airtel disbursement request failed.', {
      status: result.httpStatus,
      code: result.raw?.status?.response_code || result.raw?.status?.code,
      raw: result.raw,
    });
  }

  return result.raw;
}

async function invokeDisbursement({
  merchantReference,
  amount,
  phone,
  pin,
  encryptedPin,
  payeeName,
  reference,
  transactionType,
  signRequest,
}) {
  const plainPin = pin || readEnv('AIRTEL_DISBURSEMENT_PIN');
  const encryptedPinOverride = encryptedPin || readEnv('AIRTEL_DISBURSEMENT_PIN_ENCRYPTED');

  if (!plainPin && !encryptedPinOverride) {
    throw createAirtelError('Disbursement PIN is required.');
  }

  const accessToken = await getAccessToken();

  // Skip RSA key fetch when we already have a pre-encrypted PIN —
  // the encryption-keys endpoint may not be live yet (ROUTER119).
  let encryptedPinValue;
  if (encryptedPinOverride || isPreEncryptedPin(plainPin)) {
    encryptedPinValue = resolveEncryptedPin(null, plainPin, encryptedPinOverride);
  } else {
    const pinKeyMaterial = await getPinKeyMaterial(accessToken);
    encryptedPinValue = resolveEncryptedPin(pinKeyMaterial, plainPin, encryptedPinOverride);
  }
  const payload = buildDisbursementPayload({
    merchantReference,
    amount,
    phone,
    pin: encryptedPinValue,
    payeeName,
    reference,
    transactionType,
  });

  const signed = shouldSignDisbursement(signRequest);
  const response = await postDisbursementRequest(accessToken, payload, signRequest);
  return {
    ...toApiResult(response),
    payload: {
      ...payload,
      pin: '[encrypted]',
    },
    disbursementSigned: signed,
    pinKeySource: readEnv('AIRTEL_PIN_PUBLIC_KEY')
      ? 'AIRTEL_PIN_PUBLIC_KEY'
      : cachedRsaPinKeyMaterial
        ? 'api_pin_key'
        : 'api_encryption_key',
  };
}

/**
 * Fetch collection transaction status from Airtel.
 */
async function getTransactionStatus(transactionId) {
  const result = await invokeCollectionStatus(transactionId);

  if (!result.ok) {
    throw createAirtelError(result.message || 'Failed to fetch Airtel transaction status.', {
      status: result.httpStatus,
      code: result.raw?.status?.code || result.raw?.status_code,
      raw: result.raw,
    });
  }

  const resolved = resolveStatusFromAirtelPayload(result.raw);

  return {
    status: resolved.status,
    statusCode: resolved.statusCode,
    responseCode: resolved.responseCode,
    message: resolved.message || '',
    airtelMoneyId: resolved.airtelMoneyId || '',
    transactionId: resolved.transactionId || transactionId,
    raw: result.raw,
  };
}

async function invokeCollectionStatus(transactionId) {
  const accessToken = await getAccessToken();
  const normalizedId = sanitizeAirtelReference(transactionId, 'COL');

  const res = await fetch(`${BASE_URL}/standard/v1/payments/${encodeURIComponent(normalizedId)}`, {
    method: 'GET',
    headers: getApiHeaders(accessToken),
  });

  const data = await res.json().catch(() => ({}));
  return toApiResult({ res, data });
}

/**
 * Fetch disbursement transaction status from Airtel.
 */
async function getDisbursementStatus(transactionId, transactionType = DEFAULT_DISBURSEMENT_TRANSACTION_TYPE) {
  const result = await invokeDisbursementStatus(transactionId, transactionType);

  if (!result.ok) {
    throw createAirtelError(result.message || 'Failed to fetch Airtel disbursement status.', {
      status: result.httpStatus,
      code: result.raw?.status?.response_code || result.raw?.status?.code,
      raw: result.raw,
    });
  }

  const resolved = resolveStatusFromAirtelPayload(result.raw);

  return {
    status: resolved.status,
    statusCode: resolved.statusCode,
    responseCode: resolved.responseCode,
    message: resolved.message || '',
    transactionId: resolved.transactionId || transactionId,
    raw: result.raw,
  };
}

async function invokeDisbursementStatus(transactionId, transactionType = DEFAULT_DISBURSEMENT_TRANSACTION_TYPE) {
  const accessToken = await getAccessToken();
  const normalizedId = sanitizeAirtelReference(transactionId, 'DIS');
  const query = new URLSearchParams({ transactionType }).toString();

  const res = await fetch(
    `${BASE_URL}/standard/v2/disbursements/${encodeURIComponent(normalizedId)}?${query}`,
    {
      method: 'GET',
      headers: getApiHeaders(accessToken),
    }
  );

  const data = await res.json().catch(() => ({}));
  return toApiResult({ res, data });
}

/**
 * Collection wallet balance enquiry.
 * GET /standard/v1/users/balance
 */
async function getAccountBalance() {
  const result = await invokeAccountBalance();

  if (!result.ok) {
    throw createAirtelError(result.message || 'Failed to fetch Airtel account balance.', {
      status: result.httpStatus,
      code: result.raw?.status?.response_code || result.raw?.status?.code,
      raw: result.raw,
    });
  }

  const balanceData = result.raw?.data || {};
  const resolved = resolveStatusFromAirtelPayload(result.raw);

  return {
    status: resolved.status === 'completed' ? 'completed' : resolved.status,
    balance: balanceData.balance ?? balanceData.available_balance ?? null,
    currency: balanceData.currency || CURRENCY,
    accountStatus: balanceData.account_status || balanceData.status || null,
    responseCode: resolved.responseCode,
    message: resolved.message || '',
    raw: result.raw,
  };
}

async function invokeAccountBalance() {
  const accessToken = await getAccessToken();

  const res = await fetch(`${BASE_URL}/standard/v1/users/balance`, {
    method: 'GET',
    headers: getApiHeaders(accessToken),
  });

  const data = await res.json().catch(() => ({}));
  return toApiResult({ res, data });
}

module.exports = {
  getCallbackUrl,
  getCollectionsCallbackUrl,
  getAccessToken,
  requestCollection,
  invokeCollection,
  enquireUser,
  invokeUserEnquiry,
  getAccountBalance,
  invokeAccountBalance,
  requestDisbursement,
  invokeDisbursement,
  getTransactionStatus,
  invokeCollectionStatus,
  getDisbursementStatus,
  invokeDisbursementStatus,
  normalizeAirtelStatus,
  resolveStatusFromAirtelPayload,
  normalizeMsisdn,
  sanitizeAirtelReference,
  buildAirtelReference,
  testConnection,
};
