'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function getUserAndProfile(strapi, ctx) {
  if (!ctx.state.user?.id) return { user: null, profile: null };
  const user = await strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id);
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: user.id }, limit: 1,
  });
  return { user, profile: list?.[0] || null };
}

module.exports = createCoreController('api::entrep-post.entrep-post', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-post.entrep-post', {
      filters: { status: 'published' },
      sort: { createdAt: 'desc' },
      populate: ['author'],
    });
    ctx.send({ data: list });
  },
  async createPost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const { content, tags = [], mediaUrls = [] } = ctx.request.body || {};
    if (!content) return ctx.badRequest('content required');
    const post = await strapi.entityService.create('api::entrep-post.entrep-post', {
      data: {
        author: user.id,
        authorName: profile?.fullName || user.username,
        authorRole: profile?.role || 'learner',
        content, tags, mediaUrls,
        isExpert: profile?.isMentor || ['trainer','admin'].includes(profile?.role),
        status: 'published',
      },
    });
    ctx.send({ post });
  },
  async likePost(ctx) {
    const { user } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id);
    if (!post) return ctx.notFound();
    const likedBy = Array.isArray(post.likedBy) ? [...post.likedBy] : [];
    const has = likedBy.includes(user.id);
    const next = has ? likedBy.filter((id) => id !== user.id) : [...likedBy, user.id];
    const updated = await strapi.entityService.update('api::entrep-post.entrep-post', post.id, {
      data: { likedBy: next, likesCount: next.length },
    });
    ctx.send({ post: updated });
  },
  async addComment(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id);
    if (!post) return ctx.notFound();
    const { text } = ctx.request.body || {};
    if (!text) return ctx.badRequest('text required');
    const comments = Array.isArray(post.comments) ? [...post.comments] : [];
    comments.push({
      id: `c_${Date.now()}`, userId: user.id, authorName: profile?.fullName || user.username,
      text, createdAt: new Date().toISOString(),
    });
    const updated = await strapi.entityService.update('api::entrep-post.entrep-post', post.id, {
      data: { comments, commentsCount: comments.length },
    });
    ctx.send({ post: updated });
  },
}));
