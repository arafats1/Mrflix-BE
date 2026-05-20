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

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPublicFilters(query = {}) {
  const filters = {
    status: 'open',
    $or: [
      { closingAt: { $null: true } },
      { closingAt: { $gte: new Date().toISOString() } }
    ],
  };

  const jobFunction = cleanString(query.jobFunction);
  const industry = cleanString(query.industry);
  const location = cleanString(query.location);
  const experienceLevel = cleanString(query.experienceLevel);
  const search = cleanString(query.search);

  if (jobFunction) filters.jobFunction = jobFunction;
  if (industry) filters.industry = industry;
  if (location) filters.location = location;
  if (experienceLevel) filters.experienceLevel = experienceLevel;
  if (search) {
    filters.$and = [{
      $or: [
        { title: { $containsi: search } },
        { company: { $containsi: search } },
        { description: { $containsi: search } },
      ],
    }];
  }

  return filters;
}

async function resolveUser(strapi, ctx) {
  if (!ctx.state.user?.id) return null;
  return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
  });
  return list?.[0] || null;
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
}

module.exports = createCoreController('api::entrep-job.entrep-job', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-job.entrep-job', {
      filters: buildPublicFilters(ctx.query || {}),
      sort: { createdAt: 'desc' },
      populate: {
        postedBy: true,
        postedByProfile: true
      },
    });
    ctx.send({ data: list.map(withPostedByName) });
  },
  async mine(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();

    const list = await strapi.entityService.findMany('api::entrep-job.entrep-job', {
      filters: { postedBy: ctx.state.user.id },
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
        companyLogo: b.companyLogo,
        jobFunction: b.jobFunction,
        industry: b.industry,
        experienceLevel: b.experienceLevel,
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
        companyLogo: b.companyLogo,
        jobFunction: b.jobFunction,
        industry: b.industry,
        experienceLevel: b.experienceLevel,
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
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::entrep-job.entrep-job', id, {
      populate: ['postedBy'],
    });
    if (!existing) return ctx.notFound();
    if (existing.postedBy?.id !== user.id && !isAdminUser(user, profile)) return ctx.forbidden('Not yours');

    await strapi.entityService.delete('api::entrep-job.entrep-job', id);
    ctx.send({ success: true });
  },
  async apply(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const jobId = Number(ctx.params.id);
    const job = await strapi.entityService.findOne('api::entrep-job.entrep-job', jobId);
    if (!job) return ctx.notFound();
    const b = ctx.request.body || {};
    const applicant = await strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id);
    const application = await strapi.entityService.create('api::entrep-application.entrep-application', {
      data: {
        job: jobId,
        applicant: ctx.state.user.id,
        applicantName: applicant?.fullName || applicant?.username || b.applicantName || 'Applicant',
        coverNote: b.coverNote || b.coverLetter || '',
        portfolioUrls: Array.isArray(b.portfolioUrls) ? b.portfolioUrls : [],
        status: 'submitted'
      },
    });
    await strapi.entityService.update('api::entrep-job.entrep-job', jobId, {
      data: { applicationsCount: (job.applicationsCount || 0) + 1 },
    });
    ctx.send({ application });
  },
}));
