'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!id) return null;

    return await strapi.entityService.findOne('plugin::users-permissions.user', id, { populate: ['role'] });
  } catch {
    return null;
  }

  return null;
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
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
    const { from, to, includePast } = ctx.query;
    const user = await resolveUser(strapi, ctx);
    const profile = user ? await getProfile(strapi, user.id) : null;
    const adminUser = isAdminUser(user, profile);

    const courseIds = new Set();
    if (user) {
      const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
        filters: { user: user.id }, populate: ['course'],
      });
      enrollments.forEach((enrollment) => {
        const courseId = enrollment.course?.id;
        if (courseId) courseIds.add(courseId);
      });

      if (!adminUser && profile?.id && ['trainer', 'provider'].includes(profile.role)) {
        const managedCourses = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
          filters: { trainer: profile.id },
        });
        managedCourses.forEach((course) => {
          if (course?.id) courseIds.add(course.id);
        });
      }
    }

    const filters = { $and: [] };
    const shouldIncludePast = String(includePast || '').toLowerCase() === 'true';
    if (shouldIncludePast) {
      if (from) filters.$and.push({ startsAt: { $gte: from } });
    } else {
      const fromTime = from && !Number.isNaN(Date.parse(from)) ? Date.parse(from) : null;
      const effectiveFrom = new Date(Math.max(fromTime || 0, Date.now())).toISOString();
      filters.$and.push({ startsAt: { $gte: effectiveFrom } });
    }
    if (to) filters.$and.push({ startsAt: { $lte: to } });

    if (!adminUser) {
      const visibility = { $or: [{ visibility: 'public' }] };
      if (courseIds.size) visibility.$or.push({ course: { id: { $in: Array.from(courseIds) } } });
      if (profile?.cluster?.id) visibility.$or.push({ cluster: { id: profile.cluster.id } });
      if (user?.id) visibility.$or.push({ learner: { id: user.id } });
      
      // Also show events directly authored by the trainer/expert even if visibility isn't public
      // BUT IMPORTANT: If it's a live_session event, ONLY show it if THIS user is the trainer of that session.
      // We don't want trainers seeing OTHER trainers' sessions just because they share a course.
      if (profile?.id && ['trainer', 'provider'].includes(profile.role)) {
        visibility.$or.push({ liveSession: { trainer: profile.id } });
        visibility.$or.push({ mentorProfile: { id: profile.id } });
        
        // Remove course-based visibility for live sessions to prevent collision
        // We'll filter the final result to ensure trainers only see their own sessions
      }

      filters.$and.push(visibility);
    }

    let events = await strapi.entityService.findMany('api::entrep-event.entrep-event', {
      filters,
      sort: { startsAt: 'asc' },
      populate: { course: true, liveSession: { populate: ['trainer'] }, mentorProfile: true, learner: true, mentorship: true },
    });

    // Post-filter for trainers/experts: 
    // If it's a live session event, they should only see it if they are the trainer.
    if (!adminUser && profile?.id && ['trainer', 'provider'].includes(profile.role)) {
      events = events.filter(event => {
        if (event.eventType === 'live_session' && event.liveSession) {
          return event.liveSession.trainer?.id === profile.id;
        }
        return true;
      });
    }

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
        visibility: b.visibility || (b.courseId ? 'course' : 'public'),
        color: b.color || '#dc2626',
      },
    });
    ctx.send({ event });
  },
}));
