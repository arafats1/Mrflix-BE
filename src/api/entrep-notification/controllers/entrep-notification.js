'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id);
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!id) return null;

    return strapi.entityService.findOne('plugin::users-permissions.user', id);
  } catch {
    return null;
  }

  return null;
}

async function getProfilesByUserIds(strapi, userIds) {
  if (!userIds.length) return new Map();
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: { id: { $in: userIds } } },
    populate: ['user'],
  });
  return new Map(profiles.map((profile) => [Number(profile.user?.id), profile]));
}

function normalizeSubmissionMessage(message, actorName) {
  const raw = String(message || '').trim();
  if (!raw || !actorName) return raw;

  const suffixMatch = raw.match(/submitted work for\s+.+$/i);
  if (!suffixMatch) return raw;

  return `${actorName} ${suffixMatch[0]}`;
}

function serializeNotification(notification, profilesByUserId) {
  const actorUserId = Number(notification.actor?.id || notification.actor || 0);
  const actorProfile = profilesByUserId.get(actorUserId);
  const actorName = actorProfile?.fullName || notification.actor?.username || notification.actor?.email || 'User';
  return {
    id: notification.id,
    type: notification.type || 'system',
    title: notification.title,
    message: notification.type === 'submission'
      ? normalizeSubmissionMessage(notification.message, actorProfile?.fullName)
      : notification.message || '',
    actionUrl: notification.actionUrl || null,
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
    metadata: notification.metadata || {},
    actor: actorUserId ? {
      id: actorUserId,
      name: actorName,
      photoUrl: actorProfile?.profilePhotoUrl || '',
    } : null,
  };
}

module.exports = createCoreController('api::entrep-notification.entrep-notification', ({ strapi }) => ({
  async mine(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const limit = Math.max(1, Math.min(50, Number(ctx.query?.limit) || 20));
    const notifications = await strapi.entityService.findMany('api::entrep-notification.entrep-notification', {
      filters: { recipient: user.id },
      sort: { createdAt: 'desc' },
      limit,
      populate: { actor: true },
    });
    const actorIds = notifications.map((item) => Number(item.actor?.id || item.actor)).filter(Boolean);
    const profilesByUserId = await getProfilesByUserIds(strapi, actorIds);
    const data = notifications.map((item) => serializeNotification(item, profilesByUserId));

    ctx.send({
      data,
      unreadCount: data.filter((item) => !item.readAt).length,
    });
  },

  async read(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const notification = await strapi.entityService.findOne('api::entrep-notification.entrep-notification', ctx.params.id, {
      populate: { recipient: true, actor: true },
    });
    if (!notification) return ctx.notFound('Notification not found');
    if (Number(notification.recipient?.id || notification.recipient) !== Number(user.id)) {
      return ctx.forbidden('You can only update your own notifications');
    }

    const updated = notification.readAt
      ? notification
      : await strapi.entityService.update('api::entrep-notification.entrep-notification', notification.id, {
          data: { readAt: new Date().toISOString() },
          populate: { actor: true },
        });

    const actorIds = [Number(updated.actor?.id || updated.actor)].filter(Boolean);
    const profilesByUserId = await getProfilesByUserIds(strapi, actorIds);
    ctx.send({ data: serializeNotification(updated, profilesByUserId) });
  },

  async readAll(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const unread = await strapi.entityService.findMany('api::entrep-notification.entrep-notification', {
      filters: {
        recipient: user.id,
        readAt: { $null: true },
      },
      sort: { createdAt: 'desc' },
      limit: 100,
    });

    const now = new Date().toISOString();
    await Promise.all(
      unread.map((notification) => strapi.entityService.update('api::entrep-notification.entrep-notification', notification.id, {
        data: { readAt: now },
      }))
    );

    ctx.send({ ok: true, updated: unread.length });
  },
}));