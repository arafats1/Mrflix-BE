'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::entrep-mentorship.entrep-mentorship', ({ strapi }) => ({
  async request(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const b = ctx.request.body || {};
    if (!b.mentorId) return ctx.badRequest('mentorId required');
    const m = await strapi.entityService.create('api::entrep-mentorship.entrep-mentorship', {
      data: {
        mentor: b.mentorId, mentee: ctx.state.user.id,
        topic: b.topic, message: b.message, scheduledAt: b.scheduledAt, status: 'pending',
      },
    });
    ctx.send({ mentorship: m });
  },
  async mine(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const list = await strapi.entityService.findMany('api::entrep-mentorship.entrep-mentorship', {
      filters: { mentee: ctx.state.user.id },
      populate: ['mentor'], sort: { createdAt: 'desc' },
    });
    ctx.send({ data: list });
  },
  async listMentors(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: { isMentor: true },
      sort: { mentorRating: 'desc' },
    });
    ctx.send({ data: list });
  },
}));
