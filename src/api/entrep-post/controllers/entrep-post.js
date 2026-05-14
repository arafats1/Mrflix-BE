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

async function getProfilesByUserIds(strapi, userIds) {
  if (!userIds.length) return new Map();
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: { id: { $in: userIds } } },
    populate: ['user'],
  });
  return new Map(profiles.map((profile) => [Number(profile.user?.id), profile]));
}

function serializeMedia(mediaUrls) {
  if (!Array.isArray(mediaUrls)) return [];
  return mediaUrls
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return { type: 'image', url: item, name: item.split('/').pop() || 'media' };
      }
      if (typeof item === 'object' && item.url) return item;
      return null;
    })
    .filter(Boolean);
}

function serializePost(post, profilesByUserId) {
  const authorId = Number(post.author?.id || post.author);
  const authorProfile = profilesByUserId.get(authorId);
  return {
    ...post,
    authorPhotoUrl: authorProfile?.profilePhotoUrl || null,
    mediaUrls: serializeMedia(post.mediaUrls),
  };
}

module.exports = createCoreController('api::entrep-post.entrep-post', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-post.entrep-post', {
      filters: { status: 'published' },
      sort: { createdAt: 'desc' },
      populate: ['author'],
    });
    const authorIds = list.map((post) => Number(post.author?.id || post.author)).filter(Boolean);
    const profilesByUserId = await getProfilesByUserIds(strapi, authorIds);
    ctx.send({ data: list.map((post) => serializePost(post, profilesByUserId)) });
  },
  async createPost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const { content, tags = [], mediaUrls = [] } = ctx.request.body || {};
    const normalizedMedia = serializeMedia(mediaUrls);
    if (!String(content || '').trim() && normalizedMedia.length === 0) return ctx.badRequest('content or media required');
    const post = await strapi.entityService.create('api::entrep-post.entrep-post', {
      data: {
        author: user.id,
        authorName: profile?.fullName || user.username,
        authorRole: profile?.role || 'learner',
        content: String(content || '').trim(), tags, mediaUrls: normalizedMedia,
        isExpert: profile?.isMentor || ['trainer','admin'].includes(profile?.role),
        status: 'published',
      },
    });
    const profilesByUserId = await getProfilesByUserIds(strapi, [user.id]);
    ctx.send({ post: serializePost(post, profilesByUserId) });
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
    const profilesByUserId = await getProfilesByUserIds(strapi, [Number(updated.author?.id || updated.author)].filter(Boolean));
    ctx.send({ post: serializePost(updated, profilesByUserId) });
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
    const profilesByUserId = await getProfilesByUserIds(strapi, [Number(updated.author?.id || updated.author)].filter(Boolean));
    ctx.send({ post: serializePost(updated, profilesByUserId) });
  },
}));
