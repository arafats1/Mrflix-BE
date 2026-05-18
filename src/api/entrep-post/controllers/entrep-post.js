'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function getUserAndProfile(strapi, ctx) {
  let userId = ctx.state.user?.id || null;

  if (!userId) {
    const authHeader = ctx.request.header?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const verified = await strapi.plugins['users-permissions'].services.jwt.verify(token);
        userId = verified?.id || null;
      } catch (_) {
        userId = null;
      }
    }
  }

  if (!userId) return { user: null, profile: null };

  const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId, { populate: ['role'] });
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: user.id }, limit: 1,
  });
  return { user, profile: list?.[0] || null };
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
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
    title: post.title || '',
    postType: post.postType || 'community',
    audience: post.audience || 'public',
    alumniAudience: post.alumniAudience || null,
    isAnonymous: !!post.isAnonymous,
    authorPhotoUrl: authorProfile?.profilePhotoUrl || null,
    mediaUrls: serializeMedia(post.mediaUrls),
    discussionGroup: post.discussionGroup ? {
      id: post.discussionGroup.id || post.discussionGroup,
      title: post.discussionGroup.title || null,
      courseId: post.discussionGroup.course?.id || null,
    } : null,
  };
}

function parsePostTypes(raw) {
  const value = Array.isArray(raw) ? raw.join(',') : String(raw || '');
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ['community', 'topic', 'noticeboard', 'suggestion'].includes(item));
}

function normalizeAlumniAudience(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['learner', 'trainer', 'cluster'].includes(normalized) ? normalized : fallback;
}

function normalizeAudience(value) {
  return String(value || '').trim().toLowerCase() === 'alumni' ? 'alumni' : 'public';
}

function hasAlumniAccess(profile, alumniAudience) {
  if (!profile?.isAlumni) return false;
  return !alumniAudience || profile.alumniMemberType === alumniAudience;
}

function hasPostAccess(post, profile, isAdmin) {
  if (isAdmin) return true;
  if (post?.audience !== 'alumni') return true;
  return hasAlumniAccess(profile, post?.alumniAudience || null);
}

async function resolveDiscussionGroupMembership(strapi, user, discussionGroupId) {
  if (!discussionGroupId || !user) return null;

  const group = await strapi.entityService.findOne('api::entrep-discussion-group.entrep-discussion-group', discussionGroupId, {
    populate: {
      members: true,
      course: true,
    },
  });

  if (!group) return null;

  const isMember = Array.isArray(group.members)
    ? group.members.some((member) => Number(member?.id || member) === Number(user.id))
    : false;

  return isMember ? group : false;
}

module.exports = createCoreController('api::entrep-post.entrep-post', ({ strapi }) => ({
  async find(ctx) {
    const discussionGroupId = Number(ctx.query?.discussionGroupId);
    const requestedPostTypes = parsePostTypes(ctx.query?.postTypes);
    const mineOnly = String(ctx.query?.mine || '').toLowerCase() === 'true';
    const requestedAudience = normalizeAudience(ctx.query?.audience);
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    const isAdmin = isAdminUser(user, profile);
    const filters = {
      status: 'published',
      discussionGroup: { id: { $null: true } },
      postType: requestedPostTypes.length ? { $in: requestedPostTypes } : { $in: ['community', 'topic', 'noticeboard'] },
    };

    if (requestedAudience === 'alumni') {
      if (!user) return ctx.unauthorized();
      if (!profile?.isAlumni && !isAdmin) return ctx.forbidden('Join the alumni network to view alumni posts');

      const requestedAlumniAudience = normalizeAlumniAudience(
        ctx.query?.alumniAudience,
        profile?.alumniMemberType || null
      );
      if (!isAdmin && requestedAlumniAudience && requestedAlumniAudience !== profile?.alumniMemberType) {
        return ctx.forbidden('You can only view your own alumni network');
      }

      filters.alumniAudience = requestedAlumniAudience || profile?.alumniMemberType || null;
      filters.$or = [
        { audience: 'alumni' },
        { audience: 'public' },
        { audience: { $null: true } },
      ];
    } else {
      filters.audience = { $in: ['public', null] };
    }

    if (mineOnly) {
      if (!user?.id) return ctx.unauthorized();
      filters.author = user.id;
    }

    if (Number.isFinite(discussionGroupId) && discussionGroupId > 0) {
      if (!user?.id) return ctx.unauthorized();
      const group = await resolveDiscussionGroupMembership(strapi, user, discussionGroupId);
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
    ctx.send({ data: list.filter((post) => hasPostAccess(post, profile, isAdmin)).map((post) => serializePost(post, profilesByUserId)) });
  },
  async createPost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const { content, tags = [], mediaUrls = [], discussionGroupId, title, postType = 'community', isAnonymous = false, audience, alumniAudience } = ctx.request.body || {};
    const normalizedMedia = serializeMedia(mediaUrls);
    const normalizedPostType = ['community', 'topic', 'noticeboard', 'suggestion'].includes(postType) ? postType : 'community';
    const normalizedAudience = normalizeAudience(audience);
    const normalizedAlumniAudience = normalizeAlumniAudience(alumniAudience, profile?.alumniMemberType || null);
    if (!String(content || '').trim() && normalizedMedia.length === 0) return ctx.badRequest('content or media required');
    if (['topic', 'noticeboard'].includes(normalizedPostType) && !String(title || '').trim()) {
      return ctx.badRequest('title is required');
    }
    if (normalizedPostType === 'suggestion' && profile?.role !== 'learner') {
      return ctx.forbidden('Only learners can submit suggestions');
    }
    if (normalizedPostType === 'noticeboard' && !['trainer', 'admin'].includes(profile?.role)) {
      return ctx.forbidden('Only trainers and admins can publish noticeboard items');
    }
    if (normalizedAudience === 'alumni' && !hasAlumniAccess(profile, normalizedAlumniAudience)) {
      return ctx.forbidden('Only matching alumni members can publish into this alumni network');
    }

    let discussionGroup = null;
    const parsedDiscussionGroupId = Number(discussionGroupId);
    if (Number.isFinite(parsedDiscussionGroupId) && parsedDiscussionGroupId > 0) {
      discussionGroup = await resolveDiscussionGroupMembership(strapi, user, parsedDiscussionGroupId);
      if (discussionGroup === false) return ctx.forbidden('Join this discussion group before posting');
      if (!discussionGroup) return ctx.notFound('Discussion group not found');
    }

    const shouldHideName = normalizedPostType === 'suggestion' && Boolean(isAnonymous);
    const post = await strapi.entityService.create('api::entrep-post.entrep-post', {
      data: {
        author: user.id,
        discussionGroup: discussionGroup?.id || null,
        title: String(title || '').trim() || null,
        authorName: shouldHideName ? 'Anonymous learner' : (profile?.fullName || user.username),
        authorRole: profile?.role || 'learner',
        content: String(content || '').trim(), tags, mediaUrls: normalizedMedia,
        isAnonymous: shouldHideName,
        postType: normalizedPostType,
        audience: normalizedAudience,
        alumniAudience: normalizedAudience === 'alumni' ? normalizedAlumniAudience : null,
        isExpert: profile?.isMentor || ['trainer','admin'].includes(profile?.role),
        status: 'published',
      },
      populate: ['author', 'discussionGroup'],
    });
    const profilesByUserId = await getProfilesByUserIds(strapi, [user.id]);
    ctx.send({ post: serializePost(post, profilesByUserId) });
  },
  async deletePost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id, {
      populate: ['author'],
    });
    if (!post) return ctx.notFound();

    if (Number(post.author?.id || post.author) !== Number(user.id) && !isAdminUser(user, profile)) {
      return ctx.forbidden('Not yours');
    }

    await strapi.entityService.delete('api::entrep-post.entrep-post', post.id);
    ctx.send({ success: true });
  },
  async likePost(ctx) {
    const { user, profile } = await getUserAndProfile(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const post = await strapi.entityService.findOne('api::entrep-post.entrep-post', ctx.params.id, {
      populate: ['discussionGroup'],
    });
    if (!post) return ctx.notFound();
    if (!hasPostAccess(post, profile, isAdminUser(user, profile))) {
      return ctx.forbidden('This post belongs to another alumni network');
    }
    if (post.discussionGroup) {
      const discussionGroup = await resolveDiscussionGroupMembership(strapi, user, Number(post.discussionGroup.id || post.discussionGroup));
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
    if (!hasPostAccess(post, profile, isAdminUser(user, profile))) {
      return ctx.forbidden('This post belongs to another alumni network');
    }
    if (post.discussionGroup) {
      const discussionGroup = await resolveDiscussionGroupMembership(strapi, user, Number(post.discussionGroup.id || post.discussionGroup));
      if (discussionGroup === false) return ctx.forbidden('Join this discussion group before commenting');
    }
    const { text } = ctx.request.body || {};
    if (!text) return ctx.badRequest('text required');
    const comments = Array.isArray(post.comments) ? [...post.comments] : [];
    comments.push({
      id: `c_${Date.now()}`, userId: user.id, authorName: profile?.fullName || user.username,
      authorPhotoUrl: profile?.profilePhotoUrl || null,
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
