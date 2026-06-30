'use strict';

/**
 * WhatsApp Business API helper
 * Uses approved message templates for business-initiated messages
 */

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

function getConfig() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    adminNumber: process.env.ADMIN_WHATSAPP_NUMBER,
  };
}

/**
 * Format a Ugandan phone number to international format
 * Converts 07XXXXXXXX or 7XXXXXXXX → 2567XXXXXXXX
 * Already international (2567...) passes through
 * @param {string} number - phone number in any local format
 * @returns {string} phone number in 256XXXXXXXXX format
 */
function formatUgandanNumber(number) {
  if (!number) return '';
  // Strip everything except digits
  let digits = number.replace(/[^0-9]/g, '');

  // 07XXXXXXXX → 2567XXXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '256' + digits.substring(1);
  }
  // 7XXXXXXXX (9 digits) → 2567XXXXXXXX
  else if (digits.length === 9 && digits.startsWith('7')) {
    digits = '256' + digits;
  }

  return digits;
}

function recipientNotOnWhatsApp(errorCode) {
  const code = Number(errorCode || 0);
  return code === 131026 || code === 133010;
}

/**
 * Send a template message via WhatsApp Cloud API
 * @returns {Promise<{ ok: boolean, data?: object, errorCode?: number, errorMessage?: string, recipientNotOnWhatsApp?: boolean }|null>}
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyParams = []) {
  const { phoneNumberId, accessToken } = getConfig();

  if (!phoneNumberId || !accessToken) {
    return null;
  }

  const recipient = formatUgandanNumber(to);
  if (!recipient) {
    return { ok: false, errorMessage: 'Invalid recipient number' };
  }

  const url = `${WHATSAPP_API_URL}/${phoneNumberId}/messages`;

  const components = [];
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((value) => ({
        type: 'text',
        text: String(value),
      })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorCode = Number(data?.error?.code || 0);
      return {
        ok: false,
        errorCode,
        errorMessage: data?.error?.message || 'WhatsApp API error',
        recipientNotOnWhatsApp: recipientNotOnWhatsApp(errorCode),
      };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, errorMessage: err.message || 'WhatsApp request failed' };
  }
}

/**
 * Notify admin that a new movie request was submitted
 * Template: new_flix_request
 * Params: {{1}}=title, {{2}}=type, {{3}}=requesterName, {{4}}=userWhatsApp
 */
async function notifyAdminNewRequest({ title, type, requesterName, whatsappNumber }) {
  const { adminNumber } = getConfig();
  if (!adminNumber) {
    return;
  }

  return sendTemplateMessage(
    adminNumber,
    'new_flix_request',
    'en',
    [title, type || 'movie', requesterName, whatsappNumber || 'Not provided']
  );
}

/**
 * Notify user that their requested movie is now available
 * Template: flix_available
 * Params: {{1}}=title, {{2}}=userName
 */
async function notifyUserMovieAvailable({ to, title, userName }) {
  if (!to) return null;

  return sendTemplateMessage(
    to,
    'flix_available',
    'en',
    [title, userName || 'there']
  );
}

module.exports = {
  formatUgandanNumber,
  recipientNotOnWhatsApp,
  sendTemplateMessage,
  notifyAdminNewRequest,
  notifyUserMovieAvailable,
};
