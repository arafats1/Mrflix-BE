'use strict';

/**
 * Pesapal Payment Integration Utility
 *
 * Uses Pesapal 3.0 REST API.
 * Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
 *
 * Flow:
 *   1. getAccessToken() – authenticate with consumer key/secret
 *   2. registerIPN() – register the IPN callback URL (once, on bootstrap)
 *   3. submitOrder() – create an order, returns a redirect URL for the user
 *   4. getTransactionStatus() – called from IPN handler to verify payment
 */

const PESAPAL_ENV = process.env.PESAPAL_ENV || 'live'; // 'sandbox' or 'live'
const BASE_URL =
  PESAPAL_ENV === 'sandbox'
    ? 'https://cybqa.pesapal.com/pesapalv3'
    : 'https://pay.pesapal.com/v3';

const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Authenticate with Pesapal and get an access token.
 * Tokens are cached until they expire.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer_key: CONSUMER_KEY,
      consumer_secret: CONSUMER_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  // Expire 5 minutes before actual expiry for safety
  tokenExpiry = Date.now() + (data.expiryDate ? new Date(data.expiryDate).getTime() - Date.now() - 5 * 60 * 1000 : 4 * 60 * 1000);
  return cachedToken;
}

/**
 * Register an IPN (Instant Payment Notification) URL with Pesapal.
 * Should be called once during bootstrap. Returns the ipn_id.
 */
async function registerIPN(callbackUrl) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: callbackUrl,
      ipn_notification_type: 'GET',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal IPN registration failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.ipn_id;
}

/**
 * Submit a payment order to Pesapal.
 *
 * @param {object} params
 * @param {string} params.merchantReference – unique order/transaction ID
 * @param {number} params.amount – amount in UGX
 * @param {string} params.description – what the user is paying for
 * @param {string} params.callbackUrl – URL to redirect user after payment
 * @param {string} params.ipnId – registered IPN id
 * @param {object} params.billingAddress – { email, phone, firstName, lastName }
 * @returns {{ order_tracking_id, merchant_reference, redirect_url }}
 */
async function submitOrder({
  merchantReference,
  amount,
  description,
  callbackUrl,
  ipnId,
  billingAddress = {},
}) {
  const token = await getAccessToken();

  const payload = {
    id: merchantReference,
    currency: 'UGX',
    amount,
    description,
    callback_url: callbackUrl,
    notification_id: ipnId,
    billing_address: {
      email_address: billingAddress.email || '',
      phone_number: billingAddress.phone || '',
      first_name: billingAddress.firstName || '',
      last_name: billingAddress.lastName || '',
      country_code: 'UG',
    },
  };

  const res = await fetch(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal order submission failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Get the transaction status from Pesapal.
 *
 * @param {string} orderTrackingId – the order_tracking_id from submitOrder
 * @returns {{ payment_method, amount, created_date, confirmation_code, payment_status_description, ... }}
 *   payment_status_description: "Completed" | "Failed" | "Reversed" | "Invalid"
 */
async function getTransactionStatus(orderTrackingId) {
  const token = await getAccessToken();

  const res = await fetch(
    `${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal status check failed (${res.status}): ${text}`);
  }

  return res.json();
}

module.exports = {
  getAccessToken,
  registerIPN,
  submitOrder,
  getTransactionStatus,
};
