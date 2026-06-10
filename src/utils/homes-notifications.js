'use strict';

const { createNotification } = require('./entrep-notifications');

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

module.exports = {
  notifyHomesMessage,
  buildHomesChatActionUrl,
};
