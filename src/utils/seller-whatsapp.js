'use strict';

const { sendTemplateMessage } = require('./whatsapp');
const { createNotification } = require('./entrep-notifications');

const SELLER_ORDER_TEMPLATE = 'movo_seller_new_order';
const HOMES_BOOKING_TEMPLATE = 'movo_homes_new_booking';

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

  const result = await sendTemplateMessage(targetNumber, templateName, 'en', params);
  if (!result) return;
  if (result.ok) return;

  if (result.recipientNotOnWhatsApp && !whatsappNumber && contactPhone) {
    await promptSellerAddWhatsApp(strapi, sellerId, dashboardUrl);
  } else if (result.errorMessage) {
    strapi.log.warn(`Seller WhatsApp notification failed (${templateName}): ${result.errorMessage}`);
  }
}

async function notifySellerMarketplaceOrder(strapi, purchase) {
  const seller = purchase?.product?.seller;
  const sellerId = Number(seller?.id || purchase?.product?.seller || 0);
  if (!sellerId) return;

  let resolvedSeller = seller;
  if (!resolvedSeller?.phone && !resolvedSeller?.whatsappNumber) {
    resolvedSeller = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: sellerId },
      select: ['id', 'fullName', 'username', 'phone', 'paymentPhone', 'whatsappNumber'],
    });
  }
  if (!resolvedSeller) return;

  const productName = purchase.product?.name || 'your product';
  const buyerName = purchase.buyer?.fullName || purchase.buyer?.username || 'A buyer';
  const statusLabel = purchase.paymentMethod === 'pay_on_delivery'
    ? 'Pay on delivery'
    : purchase.status === 'completed'
      ? 'Payment completed'
      : 'Order placed';

  await notifySellerWhatsApp(strapi, {
    seller: resolvedSeller,
    templateName: SELLER_ORDER_TEMPLATE,
    params: [
      resolvedSeller.fullName || resolvedSeller.username || 'Seller',
      productName,
      buyerName,
      formatAmountUGX(purchase.amountUGX || purchase.product?.priceUGX),
      statusLabel,
    ],
    dashboardUrl: '/providers/orders',
  });
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
  notifySellerMarketplaceOrder,
  notifySellerHomesBooking,
  SELLER_ORDER_TEMPLATE,
  HOMES_BOOKING_TEMPLATE,
};
