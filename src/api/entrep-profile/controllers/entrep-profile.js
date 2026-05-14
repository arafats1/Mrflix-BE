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

function serializeEntrepUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    paymentPhone: user.paymentPhone || null,
    paymentCode: user.paymentCode || null,
    phone: user.phone || null,
    location: user.location || null,
  };
}

module.exports = createCoreController('api::entrep-profile.entrep-profile', ({ strapi }) => ({
  /**
   * POST /entrep/auth/register
   * Body: { name, email, password, role?, phone?, location?, expertise?, bio?, yearsOfExperience?, nationalId?, certifications?, interestedRoles? }
   * Creates a users-permissions user + entrep-profile, returns { jwt, user, profile }.
   */
  async register(ctx) {
    const body = ctx.request.body || {};
    const { name, email, password, role = 'learner' } = body;
    const allowedRoles = ['learner', 'trainer', 'cluster', 'provider', 'admin'];
    if (!name || !email || !password) return ctx.badRequest('name, email and password are required');
    if (String(password).length < 6) return ctx.badRequest('Password must be at least 6 characters');
    if (!allowedRoles.includes(role)) return ctx.badRequest('Invalid entrepreneur role');

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
      fullName: name,
      phone: body.phone || null,
      location: body.location || null,
    });

    let clusterRecord = null;
    if (role === 'cluster') {
      const clusterData = body.clusterData || {};
      if (!clusterData.name || !clusterData.organizationName || !clusterData.region) {
        return ctx.badRequest('Cluster name, organization name and region are required for cluster registration');
      }

      clusterRecord = await strapi.entityService.create('api::entrep-cluster.entrep-cluster', {
        data: {
          name: String(clusterData.name).trim(),
          organizationName: String(clusterData.organizationName).trim(),
          region: String(clusterData.region).trim(),
          contactPerson: String(clusterData.contactPerson || name).trim(),
          contactEmail: String(clusterData.contactEmail || email).toLowerCase(),
          contactPhone: clusterData.contactPhone || body.phone || null,
          description: clusterData.description || null,
          industryCategory: clusterData.industryCategory || null,
          code: `CL-${Date.now().toString(36).toUpperCase()}`,
        },
      });
    }

    const profileData = {
      user: user.id,
      fullName: name,
      email: email.toLowerCase(),
      phone: body.phone || null,
      location: body.location || null,
      bio: body.bio || null,
      expertise: body.expertise || null,
      yearsOfExperience: Number.isFinite(Number(body.yearsOfExperience)) ? Number(body.yearsOfExperience) : 0,
      nationalId: body.nationalId || null,
      certifications: Array.isArray(body.certifications) ? body.certifications.filter(Boolean) : [],
      verificationDocumentUrls: Array.isArray(body.verificationDocumentUrls) ? body.verificationDocumentUrls.filter(Boolean) : [],
      interestedRoles: Array.isArray(body.interestedRoles) ? body.interestedRoles.filter(Boolean) : [],
      role,
      onboardingComplete: role !== 'learner',
      approvalStatus: ['trainer', 'provider'].includes(role) ? 'pending' : 'approved',
    };

    const clusterId = Number(body.clusterId);
    if (clusterRecord?.id) {
      profileData.cluster = clusterRecord.id;
    } else if (Number.isFinite(clusterId) && clusterId > 0) {
      profileData.cluster = clusterId;
    }

    const profile = await strapi.entityService.create('api::entrep-profile.entrep-profile', {
      data: profileData,
    });

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });
    ctx.send({ jwt, user: serializeEntrepUser(user), profile });
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
    ctx.send({ user: serializeEntrepUser(user), profile });
  },

  async updateMe(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const allowed = [
      'fullName', 'phone', 'age', 'gender', 'location', 'bio', 'expertise', 'yearsOfExperience',
      'nationalId', 'certifications', 'verificationDocumentUrls', 'profilePhotoUrl', 'portfolioUrls', 'goal', 'interestedRoles',
      'skills', 'experienceLevel', 'educationLevel',
    ];
    const body = ctx.request.body || {};
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];

    const paymentPhone = typeof body.paymentPhone === 'string' ? body.paymentPhone.trim() : undefined;
    const paymentCode = typeof body.paymentCode === 'string' ? body.paymentCode.trim() : undefined;

    if (paymentPhone !== undefined || paymentCode !== undefined) {
      await strapi.entityService.update('plugin::users-permissions.user', user.id, {
        data: {
          ...(typeof body.fullName === 'string' ? { fullName: body.fullName.trim() || null } : {}),
          ...(typeof body.phone === 'string' ? { phone: body.phone.trim() || null } : {}),
          ...(typeof body.location === 'string' ? { location: body.location.trim() || null } : {}),
          ...(paymentPhone !== undefined ? { paymentPhone: paymentPhone || null } : {}),
          ...(paymentCode !== undefined ? { paymentCode: paymentCode || null } : {}),
        },
      });
      user.paymentPhone = paymentPhone !== undefined ? (paymentPhone || null) : user.paymentPhone;
      user.paymentCode = paymentCode !== undefined ? (paymentCode || null) : user.paymentCode;
      if (typeof body.fullName === 'string') user.fullName = body.fullName.trim() || null;
      if (typeof body.phone === 'string') user.phone = body.phone.trim() || null;
      if (typeof body.location === 'string') user.location = body.location.trim() || null;
    }

    if (paymentPhone === undefined && paymentCode === undefined && (typeof body.fullName === 'string' || typeof body.phone === 'string' || typeof body.location === 'string')) {
      await strapi.entityService.update('plugin::users-permissions.user', user.id, {
        data: {
          ...(typeof body.fullName === 'string' ? { fullName: body.fullName.trim() || null } : {}),
          ...(typeof body.phone === 'string' ? { phone: body.phone.trim() || null } : {}),
          ...(typeof body.location === 'string' ? { location: body.location.trim() || null } : {}),
        },
      });
      if (typeof body.fullName === 'string') user.fullName = body.fullName.trim() || null;
      if (typeof body.phone === 'string') user.phone = body.phone.trim() || null;
      if (typeof body.location === 'string') user.location = body.location.trim() || null;
    }

    const updated = await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, { data: patch });
    ctx.send({ user: serializeEntrepUser(user), profile: updated });
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
