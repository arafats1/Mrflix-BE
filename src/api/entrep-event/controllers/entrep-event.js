'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId }, limit: 1, populate: ['cluster'],
  });
  return list?.[0] || null;
}

module.exports = createCoreController('api::entrep-event.entrep-event', ({ strapi }) => ({
  /**
   * GET /entrep/calendar?from=...&to=...
   * Returns events visible to the current user (their enrolled courses + their cluster + public).
   */
  async calendar(ctx) {
    const { from, to } = ctx.query;
    const user = await resolveUser(strapi, ctx);
    const profile = user ? await getProfile(strapi, user.id) : null;

    // Enrolled courses
    let courseIds = [];
    if (user) {
      const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
        filters: { user: user.id }, populate: ['course'],
      });
      courseIds = enrollments.map((e) => e.course?.id).filter(Boolean);
    }

    const filters = { $and: [] };
    if (from) filters.$and.push({ startsAt: { $gte: from } });
    if (to) filters.$and.push({ startsAt: { $lte: to } });

    const visibility = { $or: [{ visibility: 'public' }] };
    if (courseIds.length) visibility.$or.push({ course: { id: { $in: courseIds } } });
    if (profile?.cluster?.id) visibility.$or.push({ cluster: { id: profile.cluster.id } });
    filters.$and.push(visibility);

    const events = await strapi.entityService.findMany('api::entrep-event.entrep-event', {
      filters,
      sort: { startsAt: 'asc' },
      populate: { course: true, liveSession: true },
    });

    ctx.send({ data: events });
  },

  /**
   * POST /entrep/events  – trainer/admin creates a calendar event (e.g. quiz deadline).
   */
  async createEvent(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    if (!profile || !['trainer', 'admin', 'provider'].includes(profile.role)) {
      return ctx.forbidden('Trainer, provider or admin only');
    }
    const b = ctx.request.body || {};
    if (!b.title || !b.startsAt) return ctx.badRequest('title and startsAt required');
    const event = await strapi.entityService.create('api::entrep-event.entrep-event', {
      data: {
        title: b.title,
        description: b.description,
        eventType: b.eventType || 'announcement',
        startsAt: b.startsAt,
        endsAt: b.endsAt || b.startsAt,
        course: b.courseId || null,
        createdBy: user.id,
        visibility: b.visibility || (b.courseId ? 'course' : 'public'),
        color: b.color || '#dc2626',
      },
    });
    ctx.send({ event });
  },
}));
