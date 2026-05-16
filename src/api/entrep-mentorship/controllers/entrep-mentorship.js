'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { createNotification } = require('../../../utils/entrep-notifications');

function getDisplayName(user, profile, fallback = 'Learner') {
  return profile?.fullName || user?.fullName || user?.name || user?.username || fallback;
}

function buildMentorshipDescription(mentorName) {
  return `Mentorship session with ${mentorName || 'Expert'}`;
}

async function getProfileByUserId(strapi, userId) {
  if (!userId) return null;

  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
    populate: ['user'],
  });

  return profiles?.[0] || null;
}

module.exports = createCoreController('api::entrep-mentorship.entrep-mentorship', ({ strapi }) => ({
  async request(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const b = ctx.request.body || {};
    if (!b.mentorId) return ctx.badRequest('mentorId required');

    const mentorProfile = await strapi.entityService.findOne('api::entrep-profile.entrep-profile', b.mentorId, {
      populate: ['user'],
    });
    if (!mentorProfile) return ctx.notFound('Mentor not found');

    const menteeProfile = await getProfileByUserId(strapi, ctx.state.user.id);
    const menteeName = getDisplayName(ctx.state.user, menteeProfile, 'Learner');

    const m = await strapi.entityService.create('api::entrep-mentorship.entrep-mentorship', {
      data: {
        mentor: b.mentorId,
        mentee: ctx.state.user.id,
        topic: b.topic,
        message: b.message,
        intent: b.intent,
        scheduledAt: b.scheduledAt,
        status: 'pending',
      },
    });

    const mentorUserId = Number(mentorProfile.user?.id || mentorProfile.user || 0);
    if (mentorUserId) {
      await createNotification(strapi, {
        recipientId: mentorUserId,
        actorId: ctx.state.user.id,
        type: 'mentorship',
        title: 'New mentorship request',
        message: `${menteeName} requested mentorship${b.topic ? ` about ${b.topic}` : ''}.`,
        actionUrl: '/entrepreneur/trainer/dashboard',
        metadata: {
          mentorshipId: m.id,
          mentorProfileId: mentorProfile.id,
        },
      });
    }

    ctx.send({ mentorship: m });
  },
  async respond(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const { id } = ctx.params;
    const { status, scheduledAt, message } = ctx.request.body;

    if (!['accepted', 'rejected'].includes(status)) {
      return ctx.badRequest('Invalid status');
    }

    const mentorship = await strapi.entityService.findOne('api::entrep-mentorship.entrep-mentorship', id, {
      populate: {
        mentor: { populate: ['user'] },
        mentee: true,
      },
    });

    if (!mentorship) return ctx.notFound('Mentorship request not found');

    if (!mentorship.mentor?.user?.id || mentorship.mentor.user.id !== ctx.state.user.id) {
      return ctx.unauthorized('You are not authorized to respond to this request');
    }

    const updated = await strapi.entityService.update('api::entrep-mentorship.entrep-mentorship', id, {
      data: { status, scheduledAt, message },
    });

    if (status === 'accepted') {
      if (scheduledAt) {
        // Create an event for the calendar
        await strapi.entityService.create('api::entrep-event.entrep-event', {
          data: {
            title: `Mentorship: ${updated.topic || 'Session'}`,
            description: buildMentorshipDescription(mentorship.mentor.fullName),
            eventType: 'other',
            startsAt: scheduledAt,
            endsAt: new Date(new Date(scheduledAt).getTime() + 60 * 60 * 1000).toISOString(), // +1 hour default
            visibility: 'private',
            mentorProfile: mentorship.mentor.id,
            learner: mentorship.mentee.id,
            mentorship: mentorship.id,
            color: '#dc2626',
          },
        });
      }

      await createNotification(strapi, {
        recipientId: mentorship.mentee.id,
        actorId: mentorship.mentor?.user?.id,
        type: 'mentorship',
        title: 'Mentorship request accepted',
        message: `${mentorship.mentor?.fullName || 'Your mentor'} accepted your mentorship request${scheduledAt ? ` for ${new Date(scheduledAt).toLocaleString()}` : ''}.`,
        actionUrl: scheduledAt ? '/entrepreneur/calendar' : '/entrepreneur/dashboard',
        metadata: {
          mentorshipId: mentorship.id,
          scheduledAt,
        },
      });
    }

    ctx.send({ data: updated });
  },
  async mine(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const list = await strapi.entityService.findMany('api::entrep-mentorship.entrep-mentorship', {
      filters: { mentee: ctx.state.user.id },
      populate: ['mentor'], sort: { createdAt: 'desc' },
    });
    ctx.send({ data: list });
  },
  async listIncomingRequests(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();

    const list = await strapi.entityService.findMany('api::entrep-mentorship.entrep-mentorship', {
      filters: {
        mentor: {
          user: {
            id: ctx.state.user.id,
          },
        },
      },
      populate: {
        mentee: true,
        mentor: true,
      },
      sort: { createdAt: 'desc' },
    });

    const userIds = [...new Set(list.map((item) => item.mentee?.id).filter(Boolean))];
    let profilesByUserId = new Map();

    if (userIds.length > 0) {
      const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
        filters: { user: { id: { $in: userIds } } },
        populate: ['user'],
      });
      profilesByUserId = new Map(profiles.map((profile) => [profile.user?.id, profile]));
    }

    ctx.send({
      data: list.map((item) => ({
        ...item,
        menteeName: getDisplayName(item.mentee, profilesByUserId.get(item.mentee?.id), 'Learner'),
      })),
    });
  },
  async listMentors(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: { 
        $or: [
          { isMentor: true },
          { role: 'provider' }
        ]
      },
      sort: { mentorRating: 'desc' },
    });
    ctx.send({ data: list });
  },
}));
