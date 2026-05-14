'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function findProfileForUser(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    populate: ['cluster'],
    limit: 1,
  });
  return list?.[0] || null;
}

module.exports = createCoreController('api::entrep-profile.entrep-profile', ({ strapi }) => ({
  /**
   * POST /entrep/auth/register
   * Body: { name, email, password, role?, phone? }
   * Creates a users-permissions user + entrep-profile, returns { jwt, user, profile }.
   */
  async register(ctx) {
    const { name, email, password, role = 'learner', phone } = ctx.request.body || {};
    if (!name || !email || !password) return ctx.badRequest('name, email and password are required');
    if (String(password).length < 6) return ctx.badRequest('Password must be at least 6 characters');

    const existing = await strapi.query('plugin::users-permissions.user').findOne({ where: { email: email.toLowerCase() } });
    if (existing) return ctx.badRequest('An account with this email already exists');

    const defaultRole = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });

    const user = await strapi.plugins['users-permissions'].services.user.add({
      username: email.toLowerCase(),
      email: email.toLowerCase(),
      password,
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: defaultRole?.id,
    });

    const profile = await strapi.entityService.create('api::entrep-profile.entrep-profile', {
      data: {
        user: user.id,
        fullName: name,
        email: email.toLowerCase(),
        phone: phone || null,
        role,
        onboardingComplete: false,
        approvalStatus: role === 'trainer' ? 'pending' : 'approved',
      },
    });

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });
    ctx.send({ jwt, user: { id: user.id, email: user.email, username: user.username }, profile });
  },

  async me(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    let profile = await findProfileForUser(strapi, user.id);
    if (!profile) {
      profile = await strapi.entityService.create('api::entrep-profile.entrep-profile', {
        data: { user: user.id, fullName: user.username, email: user.email, role: 'learner', onboardingComplete: false },
      });
    }
    ctx.send({ user: { id: user.id, email: user.email, username: user.username }, profile });
  },

  async updateMe(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const allowed = [
      'fullName', 'phone', 'age', 'gender', 'location', 'bio', 'expertise', 'yearsOfExperience',
      'nationalId', 'certifications', 'profilePhotoUrl', 'portfolioUrls', 'goal', 'interestedRoles',
      'skills', 'experienceLevel', 'educationLevel',
    ];
    const body = ctx.request.body || {};
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];

    const updated = await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, { data: patch });
    ctx.send({ profile: updated });
  },

  async completeOnboarding(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const { goal, interestedRoles = [], skills = [], experienceLevel, educationLevel } = ctx.request.body || {};

    const updated = await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
      data: { goal, interestedRoles, skills, experienceLevel, educationLevel, onboardingComplete: true },
    });
    ctx.send({ profile: updated });
  },
}));
