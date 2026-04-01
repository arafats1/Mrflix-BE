// @ts-nocheck
'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::story.story', ({ strapi }) => ({
  // GET /stories - list published stories (or all for admin)
  async find(ctx) {
    const user = ctx.state.user;
    const showAll = ctx.query.all === 'true';

    let filters = { isPublished: true };

    if (showAll && user) {
      const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        populate: ['role'],
      });
      if (userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin') {
        filters = {};
      }
    }

    const stories = await strapi.documents('api::story.story').findMany({
      filters,
      sort: { createdAt: 'desc' },
    });

    return { stories };
  },

  // GET /stories/:id
  async findOne(ctx) {
    const { id } = ctx.params;
    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');
    return { story };
  },

  // POST /stories - create a story (any authenticated user)
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { videoUrl, caption, isAnonymous } = ctx.request.body;
    if (!videoUrl) return ctx.badRequest('Video is required');

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    });

    const authorName = isAnonymous
      ? 'Anonymous'
      : (fullUser?.fullName || fullUser?.username || 'User');

    const story = await strapi.documents('api::story.story').create({
      data: {
        videoUrl,
        caption: caption || '',
        authorName,
        isAnonymous: isAnonymous || false,
        isPublished: true,
        likes: [],
        comments: [],
        views: [],
        userId: fullUser?.documentId || String(user.id),
      },
    });

    return { story };
  },

  // PATCH /stories/:id - update (admin: publish/unpublish; owner: edit caption)
  async update(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';
    const isOwner = story.userId === (userWithRole?.documentId || String(user.id));

    if (!isAdmin && !isOwner) return ctx.forbidden('Not authorized');

    const allowedFields = {};
    const body = ctx.request.body;

    if (isAdmin) {
      if (body.isPublished !== undefined) allowedFields.isPublished = body.isPublished;
    }
    if (isOwner || isAdmin) {
      if (body.caption !== undefined) allowedFields.caption = body.caption;
    }

    const updated = await strapi.documents('api::story.story').update({
      documentId: id,
      data: allowedFields,
    });

    return { story: updated };
  },

  // DELETE /stories/:id - admin or owner
  async delete(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';
    const isOwner = story.userId === (userWithRole?.documentId || String(user.id));

    if (!isAdmin && !isOwner) return ctx.forbidden('Not authorized');

    await strapi.documents('api::story.story').delete({ documentId: id });
    return { success: true };
  },

  // POST /stories/:id/like - toggle like
  async toggleLike(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    });
    const uid = fullUser?.documentId || String(user.id);

    const likes = Array.isArray(story.likes) ? [...story.likes] : [];
    const index = likes.indexOf(uid);

    if (index > -1) {
      likes.splice(index, 1);
    } else {
      likes.push(uid);
    }

    const updated = await strapi.documents('api::story.story').update({
      documentId: id,
      data: { likes },
    });

    return { likes: updated.likes };
  },

  // POST /stories/:id/comment - add comment
  async addComment(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const { text } = ctx.request.body;
    if (!text?.trim()) return ctx.badRequest('Comment text is required');

    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    });

    const comments = Array.isArray(story.comments) ? [...story.comments] : [];
    comments.push({
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: fullUser?.documentId || String(user.id),
      authorName: fullUser?.fullName || fullUser?.username || 'User',
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    const updated = await strapi.documents('api::story.story').update({
      documentId: id,
      data: { comments },
    });

    return { comments: updated.comments };
  },

  // POST /stories/:id/view - record unique view
  async recordView(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Login required');

    const { id } = ctx.params;
    const story = await strapi.documents('api::story.story').findOne({ documentId: id });
    if (!story) return ctx.notFound('Story not found');

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    });
    const uid = fullUser?.documentId || String(user.id);

    const views = Array.isArray(story.views) ? [...story.views] : [];
    if (!views.includes(uid)) {
      views.push(uid);
      await strapi.documents('api::story.story').update({
        documentId: id,
        data: { views },
      });
    }

    return { views };
  },
}));
