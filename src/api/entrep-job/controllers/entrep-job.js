'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::entrep-job.entrep-job', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-job.entrep-job', {
      filters: { status: 'open' },
      sort: { createdAt: 'desc' },
    });
    ctx.send({ data: list });
  },
  async createJob(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const b = ctx.request.body || {};
    if (!b.title) return ctx.badRequest('title required');
    const job = await strapi.entityService.create('api::entrep-job.entrep-job', {
      data: {
        title: b.title, company: b.company, location: b.location,
        jobType: b.jobType || 'Full-time', salary: b.salary, skills: b.skills || [],
        description: b.description, postedBy: ctx.state.user.id, status: 'open',
        closingAt: b.closingAt,
      },
    });
    ctx.send({ job });
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
