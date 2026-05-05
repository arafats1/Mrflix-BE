'use strict';

/**
 * Africa's Talking SMS Utility
 *
 * Docs: https://developers.africastalking.com/docs/sms/sending/bulk
 *
 * Required env vars:
 *   - AT_USERNAME (use "sandbox" for testing)
 *   - AT_API_KEY
 *   - AT_SENDER_ID (optional shortcode/alphanumeric sender ID)
 */

const API_USERNAME = process.env.AT_USERNAME;
const API_KEY = process.env.AT_API_KEY;
const SENDER_ID = process.env.AT_SENDER_ID || '';

const API_URL = API_USERNAME === 'sandbox'
  ? 'https://api.sandbox.africastalking.com/version1/messaging'
  : 'https://api.africastalking.com/version1/messaging';

function normalizePhoneE164(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('0')) return `+256${p.slice(1)}`;
  if (/^\d{9,15}$/.test(p)) return `+${p}`;
  return p;
}

/**
 * Send an SMS to one or more phone numbers via Africa's Talking.
 *
 * @param {object} params
 * @param {string|string[]} params.to – recipient(s)
 * @param {string} params.message
 * @returns {object} parsed AT response
 */
async function sendSms({ to, message }) {
  if (!API_USERNAME || !API_KEY) {
    throw new Error('AT_USERNAME / AT_API_KEY environment variables are not set');
  }
  if (!message) throw new Error('SMS message is required');

  const recipients = Array.isArray(to) ? to : [to];
  const normalized = recipients.map(normalizePhoneE164).filter(Boolean);
  if (normalized.length === 0) throw new Error('No valid recipients');

  async function dispatch(includeSenderId) {
    const params = new URLSearchParams();
    params.append('username', API_USERNAME);
    params.append('to', normalized.join(','));
    params.append('message', message);
    if (includeSenderId && SENDER_ID) params.append('from', SENDER_ID);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        apiKey: API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }

    const providerMessage = data?.SMSMessageData?.Message || '';
    if (!res.ok || /InvalidSenderId/i.test(providerMessage)) {
      const err = new Error(providerMessage || `Africa's Talking SMS failed (${res.status})`);
      err.status = res.status;
      err.raw = text;
      throw err;
    }

    return data || { raw: text };
  }

  try {
    return await dispatch(true);
  } catch (err) {
    if (SENDER_ID && /InvalidSenderId/i.test(err.message || '')) {
      return dispatch(false);
    }
    throw err;
  }
}

module.exports = {
  sendSms,
  normalizePhoneE164,
};
