'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

function getDisplayName(user, profile, fallback = 'Community Member') {
  return profile?.fullName || user?.fullName || user?.name || user?.username || fallback;
}

function withPostedByName(job) {
  return {
    ...job,
    postedByName: getDisplayName(job.postedBy, job.postedByProfile),
  };
}

module.exports = createCoreController('api::entrep-job.entrep-job', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-job.entrep-job', {
      filters: {
        status: 'open',
        $or: [
          { closingAt: { $null: true } },
          { closingAt: { $gte: new Date().toISOString() } }
        ]
      },
      sort: { createdAt: 'desc' },
      populate: {
        postedBy: true,
        postedByProfile: true
      },
    });
    ctx.send({ data: list.map(withPostedByName) });
  },
  async createJob(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();

    const profile = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: { user: ctx.state.user.id },
      limit: 1,
    });

    const b = ctx.request.body || {};
    if (!b.title) return ctx.badRequest('title required');
    const job = await strapi.entityService.create('api::entrep-job.entrep-job', {
      data: {
        title: b.title,
        company: b.company,
        location: b.location,
        jobType: b.jobType || 'Full-time',
        salary: b.salary,
        skills: b.skills || [],
        description: b.description,
        postedBy: ctx.state.user.id,
        postedByProfile: profile?.[0]?.id || null,
        status: 'open',
        closingAt: b.closingAt,
        contactEmail: b.contactEmail,
        applicationLink: b.applicationLink,
      },
      populate: {
        postedBy: true,
        postedByProfile: true
      },
    });
    ctx.send({ job: withPostedByName(job) });
  },
  async updateJob(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::entrep-job.entrep-job', id, {
      populate: ['postedBy'],
    });
    if (!existing) return ctx.notFound();
    if (existing.postedBy?.id !== ctx.state.user.id) return ctx.forbidden('Not yours');

    const b = ctx.request.body || {};
    const updated = await strapi.entityService.update('api::entrep-job.entrep-job', id, {
      data: {
        title: b.title,
        company: b.company,
        location: b.location,
        jobType: b.jobType,
        salary: b.salary,
        skills: b.skills,
        description: b.description,
        closingAt: b.closingAt,
        contactEmail: b.contactEmail,
        applicationLink: b.applicationLink,
        status: b.status,
      },
      populate: {
        postedBy: true,
        postedByProfile: true
      },
    });
    ctx.send({ job: withPostedByName(updated) });
  },
  async deleteJob(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::entrep-job.entrep-job', id, {
      populate: ['postedBy'],
    });
    if (!existing) return ctx.notFound();
    if (existing.postedBy?.id !== ctx.state.user.id) return ctx.forbidden('Not yours');

    await strapi.entityService.delete('api::entrep-job.entrep-job', id);
    ctx.send({ success: true });
  },
  async apply(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const jobId = Number(ctx.params.id);
    const job = await strapi.entityService.findOne('api::entrep-job.entrep-job', jobId);
    if (!job) return ctx.notFound();
    const b = ctx.request.body || {};
    const application = await strapi.entityService.create('api::entrep-application.entrep-application', {
      data: { job: jobId, applicant: ctx.state.user.id, coverLetter: b.coverLetter, resumeUrl: b.resumeUrl, status: 'submitted' },
    });
    await strapi.entityService.update('api::entrep-job.entrep-job', jobId, {
      data: { applicationsCount: (job.applicationsCount || 0) + 1 },
    });
    ctx.send({ application });
  },
}));
