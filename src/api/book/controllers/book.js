'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
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
