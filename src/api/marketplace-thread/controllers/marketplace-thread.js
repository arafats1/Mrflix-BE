'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { randomUUID } = require('crypto');
const { notifyMarketplaceMessage } = require('../../../utils/marketplace-notifications');
const { notifyHomesMessage } = require('../../../utils/homes-notifications');

function buildHomesContext(source, listingId) {
  if (source !== 'homes') return null;
  return {
    source: 'homes',
    listingId: listingId ? String(listingId) : null,
  };
}

function isHomesThread(thread) {
  return thread?.context?.source === 'homes';
}

/**
 * Manually verify the Bearer JWT from the request headers.
 * Required because all marketplace-thread routes use `auth: false`
 * (no Strapi permission config needed), so ctx.state.user is never
 * populated automatically.
 */
async function resolveUser(ctx) {
  const authHeader = ctx.request.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: payload.id },
      select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'],
    });
    return user || null;
  } catch {
    return null;
  }
}

module.exports = createCoreController('api::marketplace-thread.marketplace-thread', ({ strapi }) => ({

  // GET /marketplace-threads  — return all threads where caller is buyer or seller
  async find(ctx) {
    const user = await resolveUser(ctx);
    if (!user) return ctx.unauthorized();

    const threads = await strapi.db.query('api::marketplace-thread.marketplace-thread').findMany({
      where: {
        $or: [
          { buyer: { id: user.id } },
          { seller: { id: user.id } },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
    });

    ctx.body = { data: threads.map((t) => sanitizeThread(t, user.id)) };
  },

  // GET /marketplace-threads/:id  — single thread (must be participant)
  async findOne(ctx) {
    const user = await resolveUser(ctx);
    if (!user) return ctx.unauthorized();

    const thread = await strapi.db.query('api::marketplace-thread.marketplace-thread').findOne({
      where: { documentId: ctx.params.id },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
    });

    if (!thread) return ctx.notFound();
    if (thread.buyer?.id !== user.id && thread.seller?.id !== user.id) return ctx.forbidden();

    // Mark unread incoming messages as read for this participant.
    const isBuyer = thread.buyer?.id === user.id;
    const unreadField = isBuyer ? 'buyerUnread' : 'sellerUnread';
    const viewerRole = isBuyer ? 'buyer' : 'seller';
    const unreadCount = Number(thread[unreadField] || 0);
    const existingMessages = Array.isArray(thread.messages) ? thread.messages : [];
    let nextMessages = existingMessages;

    if (unreadCount > 0 && existingMessages.length > 0) {
      let remaining = unreadCount;
      const readAt = new Date().toISOString();
      nextMessages = [...existingMessages];

      for (let index = nextMessages.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const message = nextMessages[index];
        const senderRole = String(message?.senderRole || '').toLowerCase();
        const sentByViewer = senderRole ? senderRole === viewerRole : message?.senderId === user.id;

        if (sentByViewer || message?.readAt) continue;

        nextMessages[index] = {
          ...message,
          readAt,
        };
        remaining -= 1;
      }
    }

    const updateData = {
      ...(isBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 }),
      ...(nextMessages !== existingMessages ? { messages: nextMessages } : {}),
    };

    await strapi.db.query('api::marketplace-thread.marketplace-thread').update({
      where: { id: thread.id },
      data: updateData,
    });

    ctx.body = { data: sanitizeThread({ ...thread, ...updateData, messages: nextMessages }, user.id) };
  },

  // POST /marketplace-threads  — find or create thread for buyer+seller+product
  async findOrCreate(ctx) {
    const user = await resolveUser(ctx);
    if (!user) return ctx.unauthorized();

    const { sellerId, productId, source, listingId } = ctx.request.body || {};
    if (!sellerId) return ctx.badRequest('sellerId is required');
    const homesContext = buildHomesContext(source, listingId);

    // Resolve seller
    const seller = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: sellerId },
      select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'],
    });
    if (!seller) return ctx.notFound('Seller not found');
    if (seller.id === user.id) return ctx.badRequest('Cannot chat with yourself');

    // Resolve product (optional)
    let product = null;
    if (productId) {
      product = await strapi.db.query('api::product.product').findOne({
        where: { documentId: productId },
        select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'],
      });
    }

    // Find existing thread between this buyer and seller
    const existing = await strapi.db.query('api::marketplace-thread.marketplace-thread').findOne({
      where: {
        buyer: { id: user.id },
        seller: { id: seller.id },
      },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      if (homesContext && !isHomesThread(existing)) {
        const updated = await strapi.db.query('api::marketplace-thread.marketplace-thread').update({
          where: { id: existing.id },
          data: { context: homesContext },
          populate: {
            buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
            seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
            product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
          },
        });
        ctx.body = { data: sanitizeThread(updated, user.id) };
        return;
      }
      ctx.body = { data: sanitizeThread(existing, user.id) };
      return;
    }

    // Create new thread
    const created = await strapi.db.query('api::marketplace-thread.marketplace-thread').create({
      data: {
        buyer: user.id,
        seller: seller.id,
        product: product?.id || null,
        messages: [],
        buyerUnread: 0,
        sellerUnread: 0,
        context: homesContext,
      },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
    });

    ctx.created({ data: sanitizeThread(created, user.id) });
  },

  // POST /marketplace-threads/:id/message  — append a message to the thread
  async sendMessage(ctx) {
    const user = await resolveUser(ctx);
    if (!user) return ctx.unauthorized();

    const thread = await strapi.db.query('api::marketplace-thread.marketplace-thread').findOne({
      where: { documentId: ctx.params.id },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
    });

    if (!thread) return ctx.notFound();

    const isBuyer = thread.buyer?.id === user.id;
    const isSeller = thread.seller?.id === user.id;
    if (!isBuyer && !isSeller) return ctx.forbidden();

    const { text, images, source, listingId } = ctx.request.body || {};
    if (!text?.trim() && (!Array.isArray(images) || images.length === 0)) {
      return ctx.badRequest('Message must have text or images');
    }

    const incomingHomesContext = buildHomesContext(source, listingId);
    let threadContext = thread.context || null;
    if (incomingHomesContext) {
      threadContext = {
        source: 'homes',
        listingId: incomingHomesContext.listingId || threadContext?.listingId || null,
      };
      if (!isHomesThread(thread)) {
        await strapi.db.query('api::marketplace-thread.marketplace-thread').update({
          where: { id: thread.id },
          data: { context: threadContext },
        });
        thread.context = threadContext;
      }
    }

    const message = {
      id: randomUUID(),
      senderId: user.id,
      senderRole: isBuyer ? 'buyer' : 'seller',
      text: (text || '').trim(),
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      sentAt: new Date().toISOString(),
      readAt: null,
    };

    const existing = Array.isArray(thread.messages) ? thread.messages : [];
    const updated = await strapi.db.query('api::marketplace-thread.marketplace-thread').update({
      where: { id: thread.id },
      data: {
        messages: [...existing, message],
        lastMessageAt: message.sentAt,
        lastMessageText: message.text || (message.images.length > 0 ? '📷 Image' : ''),
        buyerUnread: isSeller ? (thread.buyerUnread || 0) + 1 : 0,
        sellerUnread: isBuyer ? (thread.sellerUnread || 0) + 1 : 0,
      },
      populate: {
        buyer: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        seller: { select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'] },
        product: { select: ['id', 'documentId', 'name', 'featuredImage', 'priceUGX', 'itemType'] },
      },
    });

    const notifyPayload = {
      thread: { ...thread, context: threadContext || thread.context },
      message,
      sender: user,
      recipient: isBuyer ? thread.seller : thread.buyer,
      listingId: threadContext?.listingId || thread.context?.listingId || null,
    };

    if (isHomesThread(notifyPayload.thread)) {
      await notifyHomesMessage(strapi, notifyPayload);
    } else {
      await notifyMarketplaceMessage(strapi, notifyPayload);
    }

    ctx.body = { data: sanitizeThread(updated, user.id) };
  },

  // GET /seller-status/:sellerId  — get a seller's lastSeenAt (public, no auth required)
  async sellerStatus(ctx) {
    const seller = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: ctx.params.sellerId },
      select: ['id', 'documentId', 'fullName', 'username', 'lastSeenAt', 'avatarUrl'],
    });

    if (!seller) return ctx.notFound();

    ctx.body = {
      data: {
        id: seller.id,
        documentId: seller.documentId,
        name: seller.fullName || seller.username || 'Seller',
        lastSeenAt: seller.lastSeenAt || null,
        isOnline: isOnline(seller.lastSeenAt),
      },
    };
  },

  // DELETE /marketplace-threads/:id — only buyer or seller may delete
  async deleteThread(ctx) {
    const user = await resolveUser(ctx);
    if (!user) return ctx.unauthorized();

    const thread = await strapi.db.query('api::marketplace-thread.marketplace-thread').findOne({
      where: { documentId: ctx.params.id },
      populate: { buyer: { select: ['id'] }, seller: { select: ['id'] } },
    });

    if (!thread) return ctx.notFound();

    const isParticipant = thread.buyer?.id === user.id || thread.seller?.id === user.id;
    if (!isParticipant) return ctx.forbidden();

    await strapi.db.query('api::marketplace-thread.marketplace-thread').delete({ where: { id: thread.id } });

    ctx.body = { data: { deleted: true } };
  },
}));

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 3 * 60 * 1000; // 3 minutes
}

function sanitizeThread(thread, viewerUserId) {
  const buyer = thread.buyer;
  const seller = thread.seller;
  return {
    id: thread.id,
    documentId: thread.documentId,
    buyer: buyer ? {
      id: buyer.id,
      documentId: buyer.documentId,
      name: buyer.fullName || buyer.username || 'Buyer',
      avatarUrl: buyer.avatarUrl || null,
      lastSeenAt: buyer.lastSeenAt || null,
      isOnline: isOnline(buyer.lastSeenAt),
    } : null,
    seller: seller ? {
      id: seller.id,
      documentId: seller.documentId,
      name: seller.fullName || seller.username || 'Seller',
      avatarUrl: seller.avatarUrl || null,
      lastSeenAt: seller.lastSeenAt || null,
      isOnline: isOnline(seller.lastSeenAt),
    } : null,
    product: thread.product ? {
      id: thread.product.id,
      documentId: thread.product.documentId,
      name: thread.product.name,
      featuredImage: thread.product.featuredImage,
      priceUGX: thread.product.priceUGX,
      itemType: thread.product.itemType,
    } : null,
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    lastMessageAt: thread.lastMessageAt || null,
    lastMessageText: thread.lastMessageText || '',
    unreadCount: buyer?.id === viewerUserId ? (thread.buyerUnread || 0) : (thread.sellerUnread || 0),
    buyerUnread: thread.buyerUnread || 0,
    sellerUnread: thread.sellerUnread || 0,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}
