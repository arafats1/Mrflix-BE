'use strict';

const { sendTemplateMessage } = require('./whatsapp');
const { createNotification } = require('./entrep-notifications');

const HOMES_BOOKING_TEMPLATE = 'movo_homes_new_booking';

function sanitizeTemplateParam(value, fallback = '-') {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {5,}/g, '    ')
    .trim();
  return text || fallback;
}

function formatAmountUGX(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-UG');
}

function formatHomesDate(value) {
  if (!value) return 'TBD';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function promptSellerAddWhatsApp(strapi, sellerId, dashboardUrl) {
  try {
    await createNotification(strapi, {
      recipientId: sellerId,
      actorId: sellerId,
      type: 'system',
      title: 'Add your WhatsApp number',
      message: 'We could not reach you on WhatsApp using your registered phone. Add your WhatsApp number in your dashboard to receive order alerts.',
      actionUrl: dashboardUrl,
      metadata: { category: 'whatsapp_setup_required' },
    });
  } catch (err) {
    strapi.log.warn(`WhatsApp setup prompt failed: ${err.message}`);
  }
}

async function notifySellerWhatsApp(strapi, {
  seller,
  templateName,
  params,
  dashboardUrl = '/providers/dashboard',
}) {
  const sellerId = Number(seller?.id || 0);
  if (!sellerId) return;

  const whatsappNumber = (seller.whatsappNumber || '').trim();
  const contactPhone = (seller.phone || seller.paymentPhone || '').trim();
  const targetNumber = whatsappNumber || contactPhone;

  if (!targetNumber) {
    await promptSellerAddWhatsApp(strapi, sellerId, dashboardUrl);
    return;
  }

  const safeParams = (Array.isArray(params) ? params : []).map((value) => sanitizeTemplateParam(value));
  const result = await sendTemplateMessage(targetNumber, templateName, 'en', safeParams);
  if (!result) return;
  if (result.ok) return;

  if (result.recipientNotOnWhatsApp && !whatsappNumber && contactPhone) {
    await promptSellerAddWhatsApp(strapi, sellerId, dashboardUrl);
  } else if (result.errorMessage) {
    strapi.log.warn(`Seller WhatsApp notification failed (${templateName}): ${result.errorMessage}`);
  }
}

async function notifySellerHomesBooking(strapi, booking) {
  const host = booking?.host;
  const hostId = Number(host?.id || booking?.host || 0);
  if (!hostId) return;

  let resolvedHost = host;
  if (!resolvedHost?.phone && !resolvedHost?.whatsappNumber) {
    resolvedHost = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: hostId },
      select: ['id', 'fullName', 'username', 'phone', 'paymentPhone', 'whatsappNumber'],
    });
  }
  if (!resolvedHost) return;

  const listingTitle = booking.listing?.title || 'your property';
  const guestName = booking.guest?.fullName || booking.guest?.username || 'A guest';

  await notifySellerWhatsApp(strapi, {
    seller: resolvedHost,
    templateName: HOMES_BOOKING_TEMPLATE,
    params: [
      resolvedHost.fullName || resolvedHost.username || 'Host',
      listingTitle,
      guestName,
      formatHomesDate(booking.checkIn),
      formatHomesDate(booking.checkOut),
      formatAmountUGX(booking.amountUGX),
    ],
    dashboardUrl: '/homes/dashboard',
  });
}

module.exports = {
  notifySellerWhatsApp,
  notifySellerHomesBooking,
  HOMES_BOOKING_TEMPLATE,
};
