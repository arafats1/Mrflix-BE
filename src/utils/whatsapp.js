'use strict';

/**
 * WhatsApp Business API helper
 * Uses the Cloud API to send template and text messages
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
 * Send a free-form text message via WhatsApp
 * @param {string} to - recipient phone number in international format (e.g. 256784528444)
 * @param {string} message - the text message body
 */
async function sendWhatsAppMessage(to, message) {
  const { phoneNumberId, accessToken } = getConfig();

  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Missing credentials – skipping message');
    return null;
  }

  // Ensure number starts with country code, no + prefix
  const cleanNumber = to.replace(/[^0-9]/g, '');

  const url = `${WHATSAPP_API_URL}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanNumber,
        type: 'text',
        text: { body: message },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[WhatsApp] API Error:', JSON.stringify(data));
      return null;
    }

    console.log('[WhatsApp] Message sent to', cleanNumber);
    return data;
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
    return null;
  }
}

/**
 * Notify admin that a new movie request was submitted
 */
async function notifyAdminNewRequest({ title, type, requesterName, whatsappNumber }) {
  const { adminNumber } = getConfig();
  if (!adminNumber) {
    console.warn('[WhatsApp] No admin number configured – skipping alert');
    return;
  }

  const lines = [
    `🎬 *New Movie Request*`,
    ``,
    `*Title:* ${title}`,
    `*Type:* ${type || 'movie'}`,
    `*Requested by:* ${requesterName}`,
  ];

  if (whatsappNumber) {
    lines.push(`*User WhatsApp:* ${whatsappNumber}`);
  }

  lines.push('', `Check the admin panel to review this request.`);

  return sendWhatsAppMessage(adminNumber, lines.join('\n'));
}

/**
 * Notify user that their requested movie is now available
 */
async function notifyUserMovieAvailable({ to, title, adminNote }) {
  if (!to) return null;

  const lines = [
    `🎉 *Great news!*`,
    ``,
    `The movie/series you requested is now available on MrFlicks:`,
    `*${title}*`,
  ];

  if (adminNote) {
    lines.push(``, `_Note from admin: ${adminNote}_`);
  }

  lines.push('', `Open the app and enjoy watching! 🍿`);

  return sendWhatsAppMessage(to, lines.join('\n'));
}

module.exports = {
  sendWhatsAppMessage,
  notifyAdminNewRequest,
  notifyUserMovieAvailable,
};
