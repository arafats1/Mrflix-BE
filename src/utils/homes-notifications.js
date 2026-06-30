'use strict';

const { createNotification } = require('./entrep-notifications');
const { notifySellerHomesBooking } = require('./seller-whatsapp');

const BOOKING_UID = 'api::home-booking.home-booking';

function buildHomesChatActionUrl(thread, listingId) {
  const threadId = thread?.documentId;
  if (!threadId) return '/homes';
  const params = new URLSearchParams({ from: 'homes' });
  if (listingId) params.set('listing', String(listingId));
  return `/marketplace/chat/${threadId}?${params.toString()}`;
}

async function notifyHomesMessage(strapi, { thread, message, sender, recipient, listingId }) {
  const recipientId = Number(recipient?.id || 0);
  const actorId = Number(sender?.id || 0);
  if (!recipientId || recipientId === actorId) return;

  const resolvedListingId = listingId || thread?.context?.listingId || null;
  const senderName = sender.fullName || sender.username
    || (message.senderRole === 'buyer' ? 'A guest' : 'Your host');
  const messagePreview = message.text
    || (Array.isArray(message.images) && message.images.length > 0 ? 'Sent a photo' : 'Sent a message');

  try {
    await createNotification(strapi, {
      recipientId,
      actorId,
      type: 'system',
      title: 'New Homes message',
      message: `${senderName} sent you a message: ${messagePreview}`,
      actionUrl: buildHomesChatActionUrl(thread, resolvedListingId),
      metadata: {
        category: 'homes_message',
        threadId: thread.documentId,
        messageId: message.id,
        listingId: resolvedListingId,
        senderRole: message.senderRole,
      },
    });
  } catch (err) {
    strapi.log.warn(`Homes message notification failed: ${err.message}`);
  }
}

async function notifyHomesBookingConfirmed(strapi, bookingId) {
  const id = Number(bookingId || 0);
  if (!id) return;

  try {
    const booking = await strapi.entityService.findOne(BOOKING_UID, id, {
      populate: {
        listing: { fields: ['id', 'documentId', 'title'] },
        guest: { fields: ['id', 'fullName', 'username', 'phone'] },
        host: { fields: ['id', 'fullName', 'username', 'phone', 'paymentPhone', 'whatsappNumber'] },
      },
    });
    if (!booking || booking.status !== 'confirmed') return;

    const hostId = Number(booking.host?.id || booking.host || 0);
    const guestId = Number(booking.guest?.id || booking.guest || 0);
    const listingTitle = booking.listing?.title || 'your property';
    const guestName = booking.guest?.fullName || booking.guest?.username || 'A guest';

    await Promise.all([
      hostId ? createNotification(strapi, {
        recipientId: hostId,
        actorId: guestId || hostId,
        type: 'system',
        title: 'New Homes booking',
        message: `${guestName} booked ${listingTitle} (${formatHomesDate(booking.checkIn)} to ${formatHomesDate(booking.checkOut)}).`,
        actionUrl: '/homes/dashboard',
        metadata: {
          category: 'homes_booking',
          bookingId: booking.id,
          listingId: booking.listing?.documentId || null,
        },
      }) : Promise.resolve(),
      notifySellerHomesBooking(strapi, booking),
    ]);
  } catch (err) {
    strapi.log.warn(`Homes booking notification failed: ${err.message}`);
  }
}

function formatHomesDate(value) {
  if (!value) return 'TBD';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

module.exports = {
  notifyHomesMessage,
  notifyHomesBookingConfirmed,
  buildHomesChatActionUrl,
};
