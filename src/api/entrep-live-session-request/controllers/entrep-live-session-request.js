'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const whereby = require('../../../utils/whereby');
const { createNotification, listCourseLearnerIds, notifyUsers } = require('../../../utils/entrep-notifications');

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
    populate: ['user'],
  });
  return list?.[0] || null;
}

function getDisplayName(user, profile, fallback = 'Learner') {
  return profile?.fullName || user?.fullName || user?.username || user?.email || fallback;
}

module.exports = createCoreController('api::entrep-live-session-request.entrep-live-session-request', ({ strapi }) => ({
  async request(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const body = ctx.request.body || {};
    if (!body.courseId || !body.topic) return ctx.badRequest('courseId and topic are required');

    const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', body.courseId, {
      populate: { trainer: { populate: ['user'] } },
    });
    if (!course?.trainer) return ctx.notFound('Course not found');

    const enrollment = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
      filters: { user: user.id, course: course.id },
      limit: 1,
    });
    if (!enrollment?.[0]) return ctx.forbidden('Enroll in this course before requesting a live session');

    const request = await strapi.entityService.create('api::entrep-live-session-request.entrep-live-session-request', {
      data: {
        course: course.id,
        trainer: course.trainer.id,
        requester: user.id,
        topic: String(body.topic || '').trim(),
        message: String(body.message || '').trim() || null,
        status: 'pending',
      },
      populate: {
        course: true,
        trainer: { populate: ['user'] },
        requester: true,
      },
    });

    const requesterProfile = await getProfile(strapi, user.id);
    const trainerUserId = Number(course.trainer?.user?.id || course.trainer?.user || 0);
    if (trainerUserId) {
      await createNotification(strapi, {
        recipientId: trainerUserId,
        actorId: user.id,
        type: 'live_session_request',
        title: `Live session request for ${course.title}`,
        message: `${getDisplayName(user, requesterProfile)} requested a live session about ${request.topic}.`,
        actionUrl: '/entrepreneur/trainer/dashboard',
        metadata: {
          liveSessionRequestId: request.id,
          courseId: course.id,
        },
      });
    }

    ctx.send({ data: request });
  },

  async mine(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const list = await strapi.entityService.findMany('api::entrep-live-session-request.entrep-live-session-request', {
      filters: { requester: user.id },
      sort: { createdAt: 'desc' },
      populate: ['course', 'trainer', 'liveSession'],
    });
    ctx.send({ data: list });
  },

  async incoming(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    if (!profile || !['trainer', 'admin'].includes(profile.role)) return ctx.forbidden('Trainer only');

    const list = await strapi.entityService.findMany('api::entrep-live-session-request.entrep-live-session-request', {
      filters: { trainer: profile.id },
      sort: { createdAt: 'desc' },
      populate: ['course', 'requester', 'trainer', 'liveSession'],
    });

    const requesterIds = [...new Set(list.map((item) => Number(item.requester?.id || item.requester)).filter(Boolean))];
    const requesterProfiles = requesterIds.length
      ? await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
          filters: { user: { id: { $in: requesterIds } } },
          populate: ['user'],
        })
      : [];
    const profilesByUserId = new Map(requesterProfiles.map((profileItem) => [Number(profileItem.user?.id), profileItem]));

    ctx.send({
      data: list.map((item) => ({
        ...item,
        requesterName: getDisplayName(item.requester, profilesByUserId.get(Number(item.requester?.id || item.requester)), 'Learner'),
      })),
    });
  },

  async respond(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const request = await strapi.entityService.findOne('api::entrep-live-session-request.entrep-live-session-request', ctx.params.id, {
      populate: {
        course: true,
        trainer: { populate: ['user'] },
        requester: true,
      },
    });
    if (!request) return ctx.notFound('Live session request not found');
    if (Number(request.trainer?.id || request.trainer) !== Number(profile?.id) && profile?.role !== 'admin') {
      return ctx.forbidden('You can only manage your own course requests');
    }

    const { status, scheduledAt } = ctx.request.body || {};
    if (!['accepted', 'rejected'].includes(status)) return ctx.badRequest('Invalid status');

    let liveSession = null;
    if (status === 'accepted') {
      if (!scheduledAt) return ctx.badRequest('scheduledAt is required when accepting a live session request');
      const endsAt = new Date(new Date(scheduledAt).getTime() + 60 * 60 * 1000).toISOString();
      const meeting = await whereby.createMeeting({ startsAt: scheduledAt, endsAt });

      liveSession = await strapi.entityService.create('api::entrep-live-session.entrep-live-session', {
        data: {
          title: `Live session: ${request.course?.title || 'Course support'}`,
          description: request.message || `Extra support session for ${request.course?.title || 'this course'}`,
          topic: request.topic,
          startsAt: scheduledAt,
          endsAt,
          durationMinutes: 60,
          trainer: request.trainer?.id || request.trainer,
          course: request.course?.id || request.course,
          provider: 'whereby',
          hostRoomUrl: meeting.hostRoomUrl,
          viewerRoomUrl: meeting.viewerRoomUrl,
          wherebyMeetingId: meeting.meetingId,
          status: 'scheduled',
        },
      });

      await strapi.entityService.create('api::entrep-event.entrep-event', {
        data: {
          title: `Live: ${request.course?.title || 'Course support'}`,
          description: request.topic,
          eventType: 'live_session',
          startsAt: scheduledAt,
          endsAt,
          course: request.course?.id || request.course,
          liveSession: liveSession.id,
          visibility: 'course',
          color: request.trainer?.role === 'provider' ? '#dc2626' : (request.trainer?.preferredEventColor || '#2563eb'),
        },
      });
    }

    const updated = await strapi.entityService.update('api::entrep-live-session-request.entrep-live-session-request', request.id, {
      data: {
        status,
        scheduledAt: status === 'accepted' ? scheduledAt : null,
        liveSession: liveSession?.id || null,
      },
      populate: ['course', 'trainer', 'requester', 'liveSession'],
    });

    if (status === 'accepted') {
      const learnerUserIds = await listCourseLearnerIds(strapi, request.course?.id || request.course);
      await notifyUsers(strapi, learnerUserIds, {
        actorId: user.id,
        type: 'live_session',
        title: `New live support session: ${request.course?.title || 'Course support'}`,
        message: `A trainer scheduled a live support session for ${new Date(scheduledAt).toLocaleString()}.`,
        actionUrl: `/entrepreneur/sessions/${liveSession.id}`,
        metadata: {
          liveSessionRequestId: request.id,
          sessionId: liveSession.id,
          courseId: request.course?.id || request.course,
        },
      });
    } else {
      await createNotification(strapi, {
        recipientId: Number(request.requester?.id || request.requester),
        actorId: user.id,
        type: 'live_session_request',
        title: `Live session request ${status}`,
        message: status === 'rejected'
          ? `Your trainer could not schedule a live session for ${request.course?.title || 'this course'} right now.`
          : `Your trainer scheduled a live session for ${new Date(scheduledAt).toLocaleString()}.`,
        actionUrl: status === 'accepted' && liveSession ? `/entrepreneur/sessions/${liveSession.id}` : '/entrepreneur/dashboard',
        metadata: {
          liveSessionRequestId: request.id,
          sessionId: liveSession?.id || null,
        },
      });
    }

    ctx.send({ data: updated });
  },
}));