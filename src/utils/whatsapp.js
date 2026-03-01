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

  // If starts with +256, strip the +
  // digits already has no + at this point

  // 07XXXXXXXX → 2567XXXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '256' + digits.substring(1);
  }
  // 7XXXXXXXX (9 digits) → 2567XXXXXXXX
  else if (digits.length === 9 && digits.startsWith('7')) {
    digits = '256' + digits;
  }
  // Already has 256 prefix — leave as is
  // Any other format — pass through as-is

  return digits;
}

/**
 * Send a template message via WhatsApp Cloud API
 * @param {string} to - recipient phone number (will be formatted)
 * @param {string} templateName - approved template name
 * @param {string} languageCode - template language code
 * @param {Array} bodyParams - array of parameter values for the template body
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyParams = []) {
  const { phoneNumberId, accessToken } = getConfig();

  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Missing credentials – skipping message');
    return null;
  }

  const recipient = formatUgandanNumber(to);
  if (!recipient) {
    console.warn('[WhatsApp] No valid phone number provided');
    return null;
  }

  const url = `${WHATSAPP_API_URL}/${phoneNumberId}/messages`;

  const components = [];
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map(value => ({
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
    console.log(`[WhatsApp] Sending template "${templateName}" to ${recipient}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[WhatsApp] API Error:', JSON.stringify(data));
      return null;
    }

    console.log('[WhatsApp] Template message sent to', recipient, '- ID:', data.messages?.[0]?.id);
    return data;
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
    return null;
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
    console.warn('[WhatsApp] No admin number configured – skipping alert');
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
  sendTemplateMessage,
  notifyAdminNewRequest,
  notifyUserMovieAvailable,
};
