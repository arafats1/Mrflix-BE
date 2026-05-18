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

function getMentorshipDescription(description, mentorName) {
  if (mentorName) return `Mentorship session with ${mentorName}`;

  const match = String(description || '').match(/^Mentorship session between\s+(.+?)\s+and\s+.+$/i);
  if (match?.[1]) return `Mentorship session with ${match[1].trim()}`;

  return description || 'Mentorship session with Expert';
}

function sanitizeEventForCalendar(event) {
  const isMentorshipEvent = Boolean(event?.mentorship) || String(event?.title || '').startsWith('Mentorship:');
  if (!isMentorshipEvent) return event;

  return {
    ...event,
    description: getMentorshipDescription(event.description, event.mentorProfile?.fullName),
    color: event.color || '#dc2626',
  };
}

function normalizeAlumniAudience(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['learner', 'trainer', 'cluster'].includes(normalized) ? normalized : fallback;
}

function hasAlumniAccess(profile, alumniAudience) {
  if (!profile?.isAlumni) return false;
  return !alumniAudience || profile.alumniMemberType === alumniAudience;
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

    let events = await strapi.entityService.findMany('api::entrep-event.entrep-event', {
      filters,
      sort: { startsAt: 'asc' },
      populate: { course: true, liveSession: { populate: ['trainer'] }, mentorProfile: true, learner: true, mentorship: true },
    });

    if (!adminUser) {
      const visibleCourseIds = Array.from(courseIds);
      const isTrainerOrProvider = !!profile?.id && ['trainer', 'provider'].includes(profile.role);

      events = events.filter((event) => {
        if (event.visibility === 'public') return true;
        if (event.visibility === 'alumni') return hasAlumniAccess(profile, normalizeAlumniAudience(event.alumniAudience, null));

        const eventCourseId = event.course?.id;
        if (eventCourseId && visibleCourseIds.includes(eventCourseId)) return true;

        if (user?.id && event.learner?.id === user.id) return true;

        if (isTrainerOrProvider) {
          if (event.mentorProfile?.id === profile.id) return true;
          if (event.eventType === 'live_session' && event.liveSession?.trainer?.id === profile.id) return true;
        }

        return false;
      });
    }

    ctx.send({ data: events.map(sanitizeEventForCalendar) });
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
    const requestedAlumniAudience = normalizeAlumniAudience(b.alumniAudience, profile?.alumniMemberType || null);
    if (b.visibility === 'alumni' && !hasAlumniAccess(profile, requestedAlumniAudience) && !isAdminUser(user, profile)) {
      return ctx.forbidden('You can only create alumni events for your own network');
    }
    const eventColor = profile.role === 'provider'
      ? '#dc2626'
      : (profile.preferredEventColor || '#2563eb');
    const event = await strapi.entityService.create('api::entrep-event.entrep-event', {
      data: {
        title: b.title,
        description: b.description,
        eventType: b.eventType || 'announcement',
        startsAt: b.startsAt,
        endsAt: b.endsAt || b.startsAt,
        course: b.courseId || null,
        visibility: b.visibility || (b.courseId ? 'course' : 'public'),
        alumniAudience: b.visibility === 'alumni' ? requestedAlumniAudience : null,
        color: b.color || (b.visibility === 'alumni' ? '#16a34a' : eventColor),
      },
    });
    ctx.send({ event });
  },
}));
