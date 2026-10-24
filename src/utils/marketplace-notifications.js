'use strict';

const { createNotification } = require('./entrep-notifications');
const { notifyHomesMessage } = require('./homes-notifications');
const { notifySellerMarketplaceOrder, notifySellerMarketplaceMessage } = require('./seller-whatsapp');

function threadHasProduct(thread) {
  return Boolean(thread?.product?.id || thread?.product?.documentId || thread?.product);
}

async function notifyMarketplaceMessage(strapi, { thread, message, sender, recipient }) {
  if (thread?.context?.source === 'homes' || !threadHasProduct(thread)) {
    return notifyHomesMessage(strapi, {
      thread,
      message,
      sender,
      recipient,
      listingId: thread?.context?.listingId || null,
    });
  }
  const recipientId = Number(recipient?.id || 0);
  const actorId = Number(sender?.id || 0);
  if (!recipientId || recipientId === actorId) return;

  const senderName = sender.fullName || sender.username || (message.senderRole === 'buyer' ? 'Buyer' : 'Seller');
  const productName = thread.product?.name ? ` about ${thread.product.name}` : '';
  const messagePreview = message.text || (Array.isArray(message.images) && message.images.length > 0 ? 'Sent a photo' : 'Sent a message');

  try {
    await createNotification(strapi, {
      recipientId,
      actorId,
      type: 'system',
      title: 'New marketplace message',
      message: `${senderName} sent you a message${productName}: ${messagePreview}`,
      actionUrl: `/marketplace/chat/${thread.documentId}`,
      metadata: {
        category: 'marketplace_message',
        threadId: thread.documentId,
        messageId: message.id,
        productId: thread.product?.documentId || null,
        senderRole: message.senderRole,
      },
    });
  } catch (err) {
    strapi.log.warn(`Marketplace message notification failed: ${err.message}`);
  }

  const sellerId = Number(thread?.seller?.id || 0);
  const sellerIsRecipient = message?.senderRole === 'buyer' && (!sellerId || recipientId === sellerId);
  if (!sellerIsRecipient) return;

  notifySellerMarketplaceMessage(strapi, {
    thread,
    message,
    sender,
    seller: thread?.seller || recipient,
  }).catch((err) => {
    strapi.log.warn(`Seller WhatsApp message notification failed: ${err.message}`);
  });
}

async function notifyProductOrderPlaced(strapi, purchase, options = {}) {
  const product = purchase.product;
  const sellerId = Number(product?.seller?.id || product?.seller || 0);
  const buyerId = Number(purchase.buyer?.id || purchase.buyer || 0);
  if (!product || !sellerId || !buyerId) return;

  const productName = product.name || 'your product';
  const buyerName = purchase.buyer?.fullName || purchase.buyer?.username || 'A buyer';
  const statusLabel = options.statusLabel || (purchase.paymentMethod === 'pay_on_delivery' ? 'Pay on delivery' : 'Order placed');

  try {
    await Promise.all([
      createNotification(strapi, {
        recipientId: sellerId,
        actorId: buyerId,
        type: 'system',
        title: 'New marketplace order',
        message: `${buyerName} placed an order for ${productName}. ${statusLabel}.`,
        actionUrl: '/providers/orders',
        metadata: {
          category: 'marketplace_order',
          purchaseId: purchase.documentId,
          productId: product.documentId || null,
          paymentMethod: purchase.paymentMethod || null,
          status: purchase.status || null,
        },
      }),
      createNotification(strapi, {
        recipientId: buyerId,
        actorId: sellerId,
        type: 'system',
        title: 'Order placed',
        message: `Your order for ${productName} has been sent to the seller.`,
        actionUrl: '/marketplace/purchases',
        metadata: {
          category: 'marketplace_order_buyer',
          purchaseId: purchase.documentId,
          productId: product.documentId || null,
          paymentMethod: purchase.paymentMethod || null,
          status: purchase.status || null,
        },
      }),
    ]);
    notifySellerMarketplaceOrder(strapi, purchase).catch((err) => {
      strapi.log.warn(`Seller WhatsApp order notification failed: ${err.message}`);
    });
  } catch (err) {
    strapi.log.warn(`Marketplace order notification failed: ${err.message}`);
  }
}

async function notifyBuyerOrderStatus(strapi, purchase, sellerId, nextStatus) {
  const buyerId = Number(purchase.buyer?.id || purchase.buyer || 0);
  if (!buyerId || !sellerId) return;

  const productName = purchase.product?.name || 'your order';
  const label = nextStatus === 'delivered'
    ? 'marked as delivered'
    : nextStatus === 'not_delivered'
      ? 'marked as not delivered'
      : 'updated';

  try {
    await createNotification(strapi, {
      recipientId: buyerId,
      actorId: sellerId,
      type: 'system',
      title: 'Order update',
      message: `The seller ${label} ${productName}.`,
      actionUrl: '/marketplace/purchases',
      metadata: {
        category: 'marketplace_order_update',
        purchaseId: purchase.documentId,
        productId: purchase.product?.documentId || null,
        deliveryStatus: nextStatus,
      },
    });
  } catch (err) {
    strapi.log.warn(`Marketplace order update notification failed: ${err.message}`);
  }
}

function sellerHasShopCoordinates(seller) {
  const latitude = seller?.businessLatitude;
  const longitude = seller?.businessLongitude;
  if (latitude == null || latitude === '' || longitude == null || longitude === '') return false;
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

async function notifySellerMissingShopLocation(strapi, seller) {
  const sellerId = Number(seller?.id || seller);
  if (!sellerId || sellerHasShopCoordinates(seller)) return;

  try {
    const existing = await strapi.db.query('api::entrep-notification.entrep-notification').findMany({
      where: {
        recipient: sellerId,
        title: 'Add your shop location',
        readAt: { $null: true },
      },
      limit: 1,
    });
    if (existing?.length) return;

    await createNotification(strapi, {
      recipientId: sellerId,
      type: 'system',
      title: 'Add your shop location',
      message: 'Buyers cannot see a shop location on your products until you save your business coordinates.',
      actionUrl: '/providers/dashboard',
      metadata: { category: 'seller_shop_location' },
    });
  } catch (err) {
    strapi.log.warn(`Shop location notification failed: ${err.message}`);
  }
}

module.exports = {
  notifyMarketplaceMessage,
  notifyProductOrderPlaced,
  notifyBuyerOrderStatus,
  notifySellerMissingShopLocation,
  sellerHasShopCoordinates,
};