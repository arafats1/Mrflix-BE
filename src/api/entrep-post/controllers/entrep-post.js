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
    discussionGroup: post.discussionGroup ? {
      id: post.discussionGroup.id || post.discussionGroup,
      title: post.discussionGroup.title || null,
      courseId: post.discussionGroup.course?.id || null,
    } : null,
  };
}

async function resolveDiscussionGroupMembership(strapi, userId, discussionGroupId) {
  if (!discussionGroupId) return null;

  const group = await strapi.entityService.findOne('api::entrep-discussion-group.entrep-discussion-group', discussionGroupId, {
    populate: {
      members: true,
      course: true,
    },
  });

  if (!group) return null;

  const isMember = Array.isArray(group.members)
    ? group.members.some((member) => Number(member?.id || member) === Number(userId))
    : false;

  return isMember ? group : false;
}

module.exports = createCoreController('api::entrep-post.entrep-post', ({ strapi }) => ({
  async find(ctx) {
    const discussionGroupId = Number(ctx.query?.discussionGroupId);
    const filters = { status: 'published' };

    if (Number.isFinite(discussionGroupId) && discussionGroupId > 0) {
      if (!ctx.state.user?.id) return ctx.unauthorized();
      const group = await resolveDiscussionGroupMembership(strapi, ctx.state.user.id, discussionGroupId);
      if (group === false) return ctx.forbidden('Join this discussion group to view its posts');
      if (!group) return ctx.notFound('Discussion group not found');
      filters.discussionGroup = discussionGroupId;
    }

    const list = await strapi.entityService.findMany('api::entrep-post.entrep-post', {
      filters,
      sort: { createdAt: 'desc' },
      populate: ['author', 'discussionGroup'],
    });
    const authorIds = list.map((post) => Number(post.author?.id || post.author)).filter(Boolean);
    const profilesByUserId = await getProfilesByUserIds(strapi, authorIds);
    ctx.send({ data: list.map((post) => serializePost(post, profilesByUserId)) });
  },
  async createPost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const { content, tags = [], mediaUrls = [], discussionGroupId } = ctx.request.body || {};
    const normalizedMedia = serializeMedia(mediaUrls);
    if (!String(content || '').trim() && normalizedMedia.length === 0) return ctx.badRequest('content or media required');

    let discussionGroup = null;
    const parsedDiscussionGroupId = Number(discussionGroupId);
    if (Number.isFinite(parsedDiscussionGroupId) && parsedDiscussionGroupId > 0) {
      discussionGroup = await resolveDiscussionGroupMembership(strapi, user.id, parsedDiscussionGroupId);
      if (discussionGroup === false) return ctx.forbidden('Join this discussion group before posting');
      if (!discussionGroup) return ctx.notFound('Discussion group not found');
    }

    const post = await strapi.entityService.create('api::entrep-post.entrep-post', {
      data: {
        author: user.id,
        discussionGroup: discussionGroup?.id || null,
        authorName: profile?.fullName || user.username,
        authorRole: profile?.role || 'learner',
        content: String(content || '').trim(), tags, mediaUrls: normalizedMedia,
        isExpert: profile?.isMentor || ['trainer','admin'].includes(profile?.role),
        status: 'published',
      },
      populate: ['author', 'discussionGroup'],
    });
    const profilesByUserId = await getProfilesByUserIds(strapi, [user.id]);
    ctx.send({ post: serializePost(post, profilesByUserId) });
  },
  async likePost(ctx) {
    const { user } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id, {
      populate: ['discussionGroup'],
    });
    if (!post) return ctx.notFound();
    if (post.discussionGroup) {
      const discussionGroup = await resolveDiscussionGroupMembership(strapi, user.id, Number(post.discussionGroup.id || post.discussionGroup));
      if (discussionGroup === false) return ctx.forbidden('Join this discussion group before interacting');
    }
    const likedBy = Array.isArray(post.likedBy) ? [...post.likedBy] : [];
    const has = likedBy.includes(user.id);
    const next = has ? likedBy.filter((id) => id !== user.id) : [...likedBy, user.id];
    const updated = await strapi.entityService.update('api::entrep-post.entrep-post', post.id, {
      data: { likedBy: next, likesCount: next.length },
      populate: ['author', 'discussionGroup'],
    });
    const profilesByUserId = await getProfilesByUserIds(strapi, [Number(updated.author?.id || updated.author)].filter(Boolean));
    ctx.send({ post: serializePost(updated, profilesByUserId) });
  },
  async addComment(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id, {
      populate: ['discussionGroup'],
    });
    if (!post) return ctx.notFound();
    if (post.discussionGroup) {
      const discussionGroup = await resolveDiscussionGroupMembership(strapi, user.id, Number(post.discussionGroup.id || post.discussionGroup));
      if (discussionGroup === false) return ctx.forbidden('Join this discussion group before commenting');
    }
    const { text } = ctx.request.body || {};
    if (!text) return ctx.badRequest('text required');
    const comments = Array.isArray(post.comments) ? [...post.comments] : [];
    comments.push({
      id: `c_${Date.now()}`, userId: user.id, authorName: profile?.fullName || user.username,
      text, createdAt: new Date().toISOString(),
    });
    const updated = await strapi.entityService.update('api::entrep-post.entrep-post', post.id, {
      data: { comments, commentsCount: comments.length },
      populate: ['author', 'discussionGroup'],
    });
    const profilesByUserId = await getProfilesByUserIds(strapi, [Number(updated.author?.id || updated.author)].filter(Boolean));
    ctx.send({ post: serializePost(updated, profilesByUserId) });
  },
}));
