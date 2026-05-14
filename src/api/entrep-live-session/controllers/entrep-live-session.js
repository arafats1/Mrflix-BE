'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const whereby = require('../../../utils/whereby');

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function getTrainerProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId }, limit: 1,
  });
  return list?.[0] || null;
}

module.exports = createCoreController('api::entrep-live-session.entrep-live-session', ({ strapi }) => ({
  /**
   * POST /entrep/live-sessions
   * Body: { title, description, topic, startsAt, endsAt, durationMinutes, courseId?, clusterId? }
   * Creates a Whereby meeting, persists session, and creates a calendar event.
   */
  async schedule(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getTrainerProfile(strapi, user.id);
    if (!profile || !['trainer', 'admin', 'provider'].includes(profile.role)) {
      return ctx.forbidden('Only trainers, providers or admins can schedule sessions');
    }

    const { title, description, topic, startsAt, endsAt, durationMinutes = 60, courseId, clusterId } = ctx.request.body || {};
    if (!title || !startsAt) return ctx.badRequest('title and startsAt are required');

    const meeting = await whereby.createMeeting({
      startsAt,
      endsAt: endsAt || new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
    });

    const session = await strapi.entityService.create('api::entrep-live-session.entrep-live-session', {
      data: {
        title,
        description,
        topic,
        startsAt,
        endsAt: endsAt || meeting.endsAt,
        durationMinutes,
        trainer: profile.id,
        course: courseId || null,
        cluster: clusterId || null,
        provider: 'whereby',
        hostRoomUrl: meeting.hostRoomUrl,
        viewerRoomUrl: meeting.viewerRoomUrl,
        wherebyMeetingId: meeting.meetingId,
        status: 'scheduled',
      },
    });

    // Auto-create calendar event so it shows up for students
    await strapi.entityService.create('api::entrep-event.entrep-event', {
      data: {
        title: `Live: ${title}`,
        description,
        eventType: 'live_session',
        startsAt,
        endsAt: endsAt || meeting.endsAt,
        course: courseId || null,
        liveSession: session.id,
        createdBy: user.id,
        visibility: courseId ? 'course' : 'public',
        color: '#dc2626',
      },
    });

    ctx.send({ session });
  },

  /**
   * GET /entrep/live-sessions/upcoming  – upcoming sessions visible to current user.
   */
  async upcoming(ctx) {
    const now = new Date().toISOString();
    const sessions = await strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
      filters: { startsAt: { $gte: now }, status: { $in: ['scheduled', 'live'] } },
      sort: { startsAt: 'asc' },
      populate: { trainer: true, course: true },
    });
    // Strip host URLs from non-trainer responses
    const user = await resolveUser(strapi, ctx);
    const trainerProfile = user ? await getTrainerProfile(strapi, user.id) : null;
    const isTrainer = trainerProfile && ['trainer', 'admin', 'provider'].includes(trainerProfile.role);
    const clean = sessions.map((s) => ({ ...s, hostRoomUrl: isTrainer ? s.hostRoomUrl : undefined }));
    ctx.send({ data: clean });
  },

  /**
   * GET /entrep/live-sessions/:id/join  – returns the appropriate room URL for the user.
   */
  async join(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] } },
    });
    if (!session) return ctx.notFound();
    const trainerProfile = await getTrainerProfile(strapi, user.id);
    const isHost = session.trainer?.user?.id === user.id;
    const isModerator = trainerProfile && ['admin'].includes(trainerProfile.role);

    // Attendance
    const attendees = Array.isArray(session.attendees) ? [...session.attendees] : [];
    if (!attendees.find((a) => a.userId === user.id)) {
      attendees.push({ userId: user.id, joinedAt: new Date().toISOString() });
      await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, { data: { attendees } });
    }

    ctx.send({
      roomUrl: isHost || isModerator ? session.hostRoomUrl : session.viewerRoomUrl,
      isHost: !!(isHost || isModerator),
      session: { id: session.id, title: session.title, startsAt: session.startsAt, endsAt: session.endsAt },
    });
  },
}));
