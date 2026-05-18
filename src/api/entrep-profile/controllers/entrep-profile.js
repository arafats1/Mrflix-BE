'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { notifyUsers } = require('../../../utils/entrep-notifications');

const PHONE_PLACEHOLDER_EMAIL_DOMAIN = 'phone.movokids.local';

function normalizePhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  if (!raw) return '';

  let normalized = raw.replace(/[\s()+-]/g, '');
  if (normalized.startsWith('0')) normalized = `256${normalized.slice(1)}`;
  return normalized;
}

function normalizeEmail(email) {
  const raw = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return raw || '';
}

function buildPlaceholderEmail(phone) {
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone ? `${normalizedPhone}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}` : '';
}

function sanitizeOptionalEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(`@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`) ? '' : normalized;
}

function normalizePreferredEventColor(value, fallback = '#2563eb') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function normalizeDateOfBirth(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const slashMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (slashMatch) {
    const [, dayText, monthText, yearText] = slashMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const parsedSlashDate = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isNaN(parsedSlashDate.getTime()) &&
      parsedSlashDate.getUTCFullYear() === year &&
      parsedSlashDate.getUTCMonth() === month - 1 &&
      parsedSlashDate.getUTCDate() === day
    ) {
      return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function calculateAgeFromDateOfBirth(value) {
  const normalized = normalizeDateOfBirth(value);
  if (!normalized) return null;
  const birthDate = new Date(`${normalized}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : null;
}

function normalizeSocialMediaHandles(input) {
  if (Array.isArray(input)) return input.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof input === 'string') return input.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeAlumniMemberType(value, fallback = 'learner') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['learner', 'trainer', 'cluster'].includes(normalized) ? normalized : fallback;
}

function getDefaultAlumniMemberType(role) {
  return ['learner', 'trainer', 'cluster'].includes(role) ? role : 'learner';
}

async function resolveAlumniCourseTitle(strapi, courseId, fallbackTitle = null) {
  const parsedCourseId = Number(courseId);
  if (Number.isFinite(parsedCourseId) && parsedCourseId > 0) {
    const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', parsedCourseId, {
      fields: ['title'],
    });
    if (!course) {
      throw new Error('Selected alumni course was not found');
    }
    return normalizeOptionalString(course.title) || normalizeOptionalString(fallbackTitle);
  }

  return normalizeOptionalString(fallbackTitle);
}

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function findProfileForUser(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    populate: {
      cluster: {
        fields: ['name', 'organizationName']
      },
      savedJobs: true
    },
    limit: 1,
  });
  return list?.[0] || null;
}

function isModerator(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || ['admin', 'me'].includes(profile?.role);
}

function serializeEntrepUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: sanitizeOptionalEmail(user.email) || null,
    username: user.username,
    paymentPhone: user.paymentPhone || null,
    paymentCode: user.paymentCode || null,
    phone: user.phone || null,
    location: user.location || null,
  };
}

async function getMentorEligibleEnrollments(strapi, userId) {
  const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: {
      user: userId,
      certificateIssued: true,
      status: 'completed',
    },
    populate: ['course'],
    sort: { completedAt: 'desc' },
  });

  return enrollments.map((enrollment) => ({
    enrollmentId: enrollment.id,
    courseId: enrollment.course?.id || null,
    courseTitle: enrollment.course?.title || 'Course',
    finalScore: Math.round(Number(enrollment.overallScore || 0)),
    completedAt: enrollment.completedAt || null,
  })).filter((item) => item.courseId);
}

async function getAlumniEligibleEnrollments(strapi, userId) {
  const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: {
      user: userId,
      status: 'completed',
    },
    populate: ['course'],
    sort: { completedAt: 'desc' },
  });

  return enrollments.map((enrollment) => ({
    enrollmentId: enrollment.id,
    courseId: enrollment.course?.id || null,
    courseTitle: enrollment.course?.title || 'Course',
    completedAt: enrollment.completedAt || null,
    finalScore: Math.round(Number(enrollment.overallScore || 0)),
    certificateIssued: !!enrollment.certificateIssued,
  })).filter((item) => item.courseId);
}

async function listAlumniRecipientIds(strapi, alumniMemberType, excludeUserId) {
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: {
      isAlumni: true,
      alumniMemberType,
      user: {
        id: { $ne: Number(excludeUserId) || 0 },
      },
    },
    populate: ['user'],
    limit: 500,
  });

  return profiles
    .map((entry) => Number(entry?.user?.id || entry?.user))
    .filter(Boolean);
}

async function decorateProfileWithMentorStatus(strapi, profile, userId) {
  if (!profile || !userId) return profile;
  const eligibleCourses = await getMentorEligibleEnrollments(strapi, userId);
  const alumniEligibleCourses = await getAlumniEligibleEnrollments(strapi, userId);

  return {
    ...profile,
    mentorEligibility: {
      eligible: eligibleCourses.length > 0,
      activated: !!profile.isMentor,
      eligibleCourses,
    },
    alumniEligibility: {
      eligible: alumniEligibleCourses.length > 0,
      activated: !!profile.isAlumni,
      eligibleCourses: alumniEligibleCourses,
      memberType: profile.alumniMemberType || getDefaultAlumniMemberType(profile.role),
    },
  };
}

module.exports = createCoreController('api::entrep-profile.entrep-profile', ({ strapi }) => ({
  /**
   * POST /entrep/auth/register
  * Body: { name, email, password, role?, phone?, location?, expertise?, bio?, yearsOfExperience?, nationalId?, certifications?, interestedRoles?, isAlumni?, alumniMemberType?, alumniCourseId?, alumniCourseTitle?, alumniCompletionDate?, alumniCurrentBusiness? }
   * Creates a users-permissions user + entrep-profile, returns { jwt, user, profile }.
   */
  async register(ctx) {
    const body = ctx.request.body || {};
    const { name, password, role = 'learner' } = body;
    const submittedEmail = normalizeEmail(body.email);
    const normalizedPhone = normalizePhone(body.phone);
    const effectiveEmail = submittedEmail || buildPlaceholderEmail(normalizedPhone);
    const allowedRoles = ['learner', 'trainer', 'cluster', 'provider', 'admin', 'me'];
    const requestedAlumniMemberType = normalizeAlumniMemberType(body.alumniMemberType, getDefaultAlumniMemberType(role));
    const isAlumniSignup = Boolean(body.isAlumni || body.alumniCourseTitle || body.alumniCompletionDate || body.alumniCurrentBusiness);
    if (!name || !normalizedPhone || !password) return ctx.badRequest('name, phone and password are required');
    if (String(password).length < 6) return ctx.badRequest('Password must be at least 6 characters');
    if (!allowedRoles.includes(role)) return ctx.badRequest('Invalid entrepreneur role');

    if (!effectiveEmail) return ctx.badRequest('A valid phone number is required');

    if (submittedEmail) {
      const existingByEmail = await strapi.query('plugin::users-permissions.user').findOne({ where: { email: submittedEmail } });
      if (existingByEmail) return ctx.badRequest('An account with this email already exists');
    }

    const existingByPhone = await strapi.query('plugin::users-permissions.user').findOne({ where: { phone: normalizedPhone } });
    if (existingByPhone) return ctx.badRequest('An account with this phone number already exists');

    const defaultRole = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });

    const user = await strapi.plugins['users-permissions'].services.user.add({
      username: normalizedPhone || effectiveEmail,
      email: effectiveEmail,
      password,
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: defaultRole?.id,
      fullName: name,
      phone: normalizedPhone || null,
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
          contactEmail: normalizeEmail(clusterData.contactEmail || submittedEmail) || null,
          contactPhone: normalizePhone(clusterData.contactPhone || normalizedPhone) || null,
          description: clusterData.description || null,
          industryCategory: clusterData.industryCategory || null,
          code: `CL-${Date.now().toString(36).toUpperCase()}`,
        },
      });
    }

    let alumniCourseTitle = null;
    try {
      alumniCourseTitle = await resolveAlumniCourseTitle(strapi, body.alumniCourseId, body.alumniCourseTitle);
    } catch (error) {
      return ctx.badRequest(error.message || 'Selected alumni course was not found');
    }

    const profileData = {
      user: user.id,
      fullName: name,
      email: submittedEmail || null,
      phone: normalizedPhone || null,
      dateOfBirth: normalizeDateOfBirth(body.dateOfBirth),
      age: calculateAgeFromDateOfBirth(body.dateOfBirth),
      location: body.location || null,
      bio: body.bio || null,
      expertise: body.expertise || null,
      yearsOfExperience: Number.isFinite(Number(body.yearsOfExperience)) ? Number(body.yearsOfExperience) : 0,
      nationalId: body.nationalId || null,
      certifications: Array.isArray(body.certifications) ? body.certifications.filter(Boolean) : [],
      verificationDocumentUrls: Array.isArray(body.verificationDocumentUrls) ? body.verificationDocumentUrls.filter(Boolean) : [],
      socialMediaHandles: normalizeSocialMediaHandles(body.socialMediaHandles),
      interestedRoles: Array.isArray(body.interestedRoles) ? body.interestedRoles.filter(Boolean) : [],
      preferredEventColor: role === 'provider' ? '#dc2626' : normalizePreferredEventColor(body.preferredEventColor, '#2563eb'),
      role,
      isMentor: role === 'provider',
      isAlumni: isAlumniSignup,
      alumniMemberType: requestedAlumniMemberType,
      alumniCourseTitle,
      alumniCompletionDate: normalizeDateOfBirth(body.alumniCompletionDate),
      alumniCurrentBusiness: normalizeOptionalString(body.alumniCurrentBusiness),
      alumniJoinedAt: isAlumniSignup ? new Date().toISOString() : null,
      onboardingComplete: role !== 'learner',
      approvalStatus: ['trainer', 'provider', 'cluster'].includes(role) ? 'pending' : 'approved',
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

    if (profile.isAlumni) {
      const alumniRecipientIds = await listAlumniRecipientIds(strapi, profile.alumniMemberType, user.id);
      if (alumniRecipientIds.length) {
        await notifyUsers(strapi, alumniRecipientIds, {
          actorId: user.id,
          type: 'system',
          title: `${profile.fullName} joined the Alumni Network`,
          message: `${profile.fullName} joined the ${profile.alumniMemberType} alumni network.`,
          actionUrl: '/entrepreneur/alumni/network',
          metadata: {
            alumniMemberType: profile.alumniMemberType,
            profileId: profile.id,
          },
        });
      }
    }

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });
    ctx.send({ jwt, user: serializeEntrepUser(user), profile });
  },

  async me(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    let profile = await findProfileForUser(strapi, user.id);
    if (!profile) {
      profile = await strapi.entityService.create('api::entrep-profile.entrep-profile', {
        data: { user: user.id, fullName: user.username, email: sanitizeOptionalEmail(user.email) || null, role: 'learner', onboardingComplete: false },
      });
    }
    ctx.send({ user: serializeEntrepUser(user), profile: await decorateProfileWithMentorStatus(strapi, profile, user.id) });
  },

  async updateMe(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const allowed = [
      'fullName', 'phone', 'age', 'dateOfBirth', 'gender', 'location', 'bio', 'expertise', 'yearsOfExperience',
      'nationalId', 'certifications', 'verificationDocumentUrls', 'socialMediaHandles', 'profilePhotoUrl', 'portfolioUrls', 'goal', 'interestedRoles',
      'skills', 'experienceLevel', 'educationLevel', 'preferredEventColor',
      'isAlumni', 'alumniMemberType', 'alumniCourseId', 'alumniCourseTitle', 'alumniCompletionDate', 'alumniCurrentBusiness',
    ];
    const body = ctx.request.body || {};
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if ('preferredEventColor' in patch) {
      patch.preferredEventColor = profile.role === 'provider'
        ? '#dc2626'
        : normalizePreferredEventColor(patch.preferredEventColor, profile.preferredEventColor || '#2563eb');
    }
    if ('socialMediaHandles' in patch) {
      patch.socialMediaHandles = normalizeSocialMediaHandles(patch.socialMediaHandles);
    }
    if ('dateOfBirth' in patch) {
      patch.dateOfBirth = normalizeDateOfBirth(patch.dateOfBirth);
      patch.age = calculateAgeFromDateOfBirth(patch.dateOfBirth);
    }
    if ('alumniMemberType' in patch) {
      patch.alumniMemberType = normalizeAlumniMemberType(patch.alumniMemberType, profile.alumniMemberType || getDefaultAlumniMemberType(profile.role));
    }
    if ('alumniCompletionDate' in patch) {
      patch.alumniCompletionDate = normalizeDateOfBirth(patch.alumniCompletionDate);
    }
    if ('alumniCourseId' in patch || 'alumniCourseTitle' in patch) {
      try {
        patch.alumniCourseTitle = await resolveAlumniCourseTitle(
          strapi,
          'alumniCourseId' in patch ? patch.alumniCourseId : null,
          'alumniCourseTitle' in patch ? patch.alumniCourseTitle : profile.alumniCourseTitle
        );
      } catch (error) {
        return ctx.badRequest(error.message || 'Selected alumni course was not found');
      }
      delete patch.alumniCourseId;
    }
    if ('alumniCurrentBusiness' in patch) {
      patch.alumniCurrentBusiness = normalizeOptionalString(patch.alumniCurrentBusiness);
    }
    if ('isAlumni' in patch) {
      patch.isAlumni = Boolean(patch.isAlumni);
      patch.alumniJoinedAt = patch.isAlumni
        ? (profile.alumniJoinedAt || new Date().toISOString())
        : null;
    }

    const paymentPhone = typeof body.paymentPhone === 'string' ? body.paymentPhone.trim() : undefined;
    const paymentCode = typeof body.paymentCode === 'string' ? body.paymentCode.trim() : undefined;
    const normalizedIncomingPhone = typeof body.phone === 'string' ? normalizePhone(body.phone) : undefined;
    const normalizedCurrentPhone = normalizePhone(user.phone);
    const nextFullName = typeof body.fullName === 'string' ? (body.fullName.trim() || null) : undefined;
    const nextLocation = typeof body.location === 'string' ? (body.location.trim() || null) : undefined;

    const userPatch = {
      ...(nextFullName !== undefined && nextFullName !== (user.fullName || null) ? { fullName: nextFullName } : {}),
      ...(typeof body.phone === 'string' && normalizedIncomingPhone !== normalizedCurrentPhone ? { phone: normalizedIncomingPhone || null } : {}),
      ...(nextLocation !== undefined && nextLocation !== (user.location || null) ? { location: nextLocation } : {}),
      ...(paymentPhone !== undefined && paymentPhone !== (user.paymentPhone || null) ? { paymentPhone: paymentPhone || null } : {}),
      ...(paymentCode !== undefined && paymentCode !== (user.paymentCode || null) ? { paymentCode: paymentCode || null } : {}),
    };

    if (Object.keys(userPatch).length > 0) {
      await strapi.entityService.update('plugin::users-permissions.user', user.id, {
        data: userPatch,
      });
      if ('paymentPhone' in userPatch) user.paymentPhone = userPatch.paymentPhone;
      if ('paymentCode' in userPatch) user.paymentCode = userPatch.paymentCode;
      if ('fullName' in userPatch) user.fullName = userPatch.fullName;
      if ('phone' in userPatch) user.phone = userPatch.phone;
      if ('location' in userPatch) user.location = userPatch.location;
    }

    const updated = await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, { data: patch });
    ctx.send({ user: serializeEntrepUser(user), profile: await decorateProfileWithMentorStatus(strapi, updated, user.id) });
  },

  async updateApprovalStatus(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await findProfileForUser(strapi, user.id);
    if (!isModerator(user, profile)) return ctx.forbidden('Admin or M&E access required');

    const targetId = Number(ctx.params.id);
    if (!Number.isFinite(targetId) || targetId <= 0) return ctx.badRequest('Valid profile id is required');

    const approvalStatus = String(ctx.request.body?.approvalStatus || '').trim().toLowerCase();
    if (!['pending', 'approved', 'rejected', 'clarification'].includes(approvalStatus)) {
      return ctx.badRequest('Invalid approval status');
    }

    const targetProfile = await strapi.entityService.findOne('api::entrep-profile.entrep-profile', targetId, {
      populate: ['user', 'cluster'],
    });
    if (!targetProfile) return ctx.notFound('Profile not found');

    const updatedProfile = await strapi.entityService.update('api::entrep-profile.entrep-profile', targetId, {
      data: { approvalStatus },
      populate: ['user', 'cluster'],
    });

    ctx.send({ profile: updatedProfile });
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
    ctx.send({ profile: await decorateProfileWithMentorStatus(strapi, updated, user.id) });
  },

  async becomeMentor(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const eligibleCourses = await getMentorEligibleEnrollments(strapi, user.id);
    if (!eligibleCourses.length) {
      return ctx.forbidden('You become a mentor after completing and passing at least one course');
    }

    const updated = profile.isMentor
      ? profile
      : await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
          data: { isMentor: true },
        });

    ctx.send({ profile: await decorateProfileWithMentorStatus(strapi, updated, user.id) });
  },

  async becomeAlumni(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound('Profile not found');

    const eligibleCourses = await getAlumniEligibleEnrollments(strapi, user.id);
    if (!eligibleCourses.length) {
      return ctx.forbidden('You can join the alumni network after completing at least one course');
    }

    const requestedMemberType = normalizeAlumniMemberType(
      ctx.request.body?.alumniMemberType,
      profile.alumniMemberType || getDefaultAlumniMemberType(profile.role)
    );
    const latestCourse = eligibleCourses[0];
    let alumniCourseTitle;
    try {
      alumniCourseTitle = await resolveAlumniCourseTitle(
        strapi,
        ctx.request.body?.alumniCourseId,
        normalizeOptionalString(ctx.request.body?.alumniCourseTitle) || profile.alumniCourseTitle || latestCourse.courseTitle
      );
    } catch (error) {
      return ctx.badRequest(error.message || 'Selected alumni course was not found');
    }
    const updated = await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
      data: {
        isAlumni: true,
        alumniMemberType: requestedMemberType,
        alumniCourseTitle,
        alumniCompletionDate: normalizeDateOfBirth(ctx.request.body?.alumniCompletionDate) || profile.alumniCompletionDate || latestCourse.completedAt,
        alumniCurrentBusiness: normalizeOptionalString(ctx.request.body?.alumniCurrentBusiness) || profile.alumniCurrentBusiness || null,
        alumniJoinedAt: profile.alumniJoinedAt || new Date().toISOString(),
      },
    });

    const alumniRecipientIds = await listAlumniRecipientIds(strapi, requestedMemberType, user.id);
    if (alumniRecipientIds.length) {
      await notifyUsers(strapi, alumniRecipientIds, {
        actorId: user.id,
        type: 'system',
        title: `${updated.fullName} joined the Alumni Network`,
        message: `${updated.fullName} joined the ${requestedMemberType} alumni network.`,
        actionUrl: '/entrepreneur/alumni/network',
        metadata: {
          alumniMemberType: requestedMemberType,
          profileId: updated.id,
        },
      });
    }

    ctx.send({ profile: await decorateProfileWithMentorStatus(strapi, updated, user.id) });
  },

  async saveJob(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound();

    const jobId = Number(ctx.params.id);
    const savedJobs = Array.isArray(profile.savedJobs) ? profile.savedJobs.map(j => j.id) : [];

    if (!savedJobs.includes(jobId)) {
      await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
        data: { savedJobs: [...savedJobs, jobId] }
      });
    }
    ctx.send({ success: true });
  },

  async unsaveJob(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await findProfileForUser(strapi, user.id);
    if (!profile) return ctx.notFound();

    const jobId = Number(ctx.params.id);
    const savedJobs = Array.isArray(profile.savedJobs) ? profile.savedJobs.map(j => j.id) : [];

    await strapi.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
      data: { savedJobs: savedJobs.filter(id => id !== jobId) }
    });
    ctx.send({ success: true });
  },
}));
