'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function getCurrentUserWithRole(strapi, userId) {
  if (!userId) return null;
  return strapi.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
}

async function resolveUserWithRole(strapi, ctx) {
  if (ctx.state.user?.id) {
    return getCurrentUserWithRole(strapi, ctx.state.user.id);
  }

  const authHeader = ctx.request.header?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
      if (id) {
        return getCurrentUserWithRole(strapi, id);
      }
    } catch (_) {
      return null;
    }
  }

  return null;
}

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
  async grantFullAccess(ctx) {
    const currentUser = await resolveUserWithRole(strapi, ctx);
    if (!currentUser) return ctx.unauthorized('You must be logged in');

    const isAdmin = currentUser?.role?.type === 'admin' || currentUser?.role?.name === 'Admin';
    if (!isAdmin) return ctx.forbidden('Only admins can grant book access');

    const { userId } = ctx.request.body.data || ctx.request.body || {};
    if (!userId) return ctx.badRequest('Missing required field: userId');

    const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
    if (!targetUser) return ctx.notFound('User not found');

    const updated = await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: {
        hasBookLibraryAccess: true,
        bookLibraryAccessGrantedAt: new Date().toISOString(),
      },
    });

    return {
      data: {
        id: updated.id,
        hasBookLibraryAccess: !!updated.hasBookLibraryAccess,
        bookLibraryAccessGrantedAt: updated.bookLibraryAccessGrantedAt || null,
      },
    };
  },

  async revokeFullAccess(ctx) {
    const currentUser = await resolveUserWithRole(strapi, ctx);
    if (!currentUser) return ctx.unauthorized('You must be logged in');

    const isAdmin = currentUser?.role?.type === 'admin' || currentUser?.role?.name === 'Admin';
    if (!isAdmin) return ctx.forbidden('Only admins can revoke book access');

    const { userId } = ctx.request.body.data || ctx.request.body || {};
    if (!userId) return ctx.badRequest('Missing required field: userId');

    const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
    if (!targetUser) return ctx.notFound('User not found');

    const updated = await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: {
        hasBookLibraryAccess: false,
        bookLibraryAccessGrantedAt: null,
      },
    });

    return {
      data: {
        id: updated.id,
        hasBookLibraryAccess: !!updated.hasBookLibraryAccess,
        bookLibraryAccessGrantedAt: updated.bookLibraryAccessGrantedAt || null,
      },
    };
  },

  async toggleLike(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const book = await strapi.documents('api::book.book').findOne({ documentId: id });
    if (!book) return ctx.notFound('Book not found');

    const userId = String(user.id);
    const likedBy = Array.isArray(book.likedBy) ? [...book.likedBy] : [];
    const idx = likedBy.indexOf(userId);
    let liked;
    if (idx >= 0) {
      likedBy.splice(idx, 1);
      liked = false;
    } else {
      likedBy.push(userId);
      liked = true;
    }

    const updated = await strapi.documents('api::book.book').update({
      documentId: id,
      data: { likedBy, likesCount: likedBy.length },
    });

    return { liked, likesCount: updated.likesCount };
  },

  async addComment(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const { text } = ctx.request.body || {};
    if (!text || !text.trim()) return ctx.badRequest('Comment text is required');

    const book = await strapi.documents('api::book.book').findOne({ documentId: id });
    if (!book) return ctx.notFound('Book not found');

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    });

    const comments = Array.isArray(book.comments) ? [...book.comments] : [];
    comments.push({
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: fullUser?.documentId || String(user.id),
      authorName: fullUser?.fullName || fullUser?.username || 'User',
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    const updated = await strapi.documents('api::book.book').update({
      documentId: id,
      data: { comments },
    });

    return { comments: updated.comments };
  },
}));
