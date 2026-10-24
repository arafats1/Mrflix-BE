'use strict';

const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { reverseGeocodePlaceName } = require('../../../utils/reverse-geocode');

const EDUCATION_LEVEL_OPTIONS = ['Kindergarten', 'Primary', 'Secondary', 'Technical college', 'University', 'Other'];
const RELIGION_OPTIONS = ['Catholic', 'Protestant', 'Pentecostal', 'Adventist', 'Orthodox', 'Muslim', 'Hindu', 'Bahai', 'Traditional', 'Other'];
const PROVIDER_TYPE_OPTIONS = ['teacher', 'religious', 'seller', 'musician', 'creative_artist', 'comedian'];

function normalizeProviderTypes(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.filter((value) => PROVIDER_TYPE_OPTIONS.includes(value)))];
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return [...new Set(parsed.filter((value) => PROVIDER_TYPE_OPTIONS.includes(value)))];
        }
      } catch {
        // fall through
      }
    }
    if (PROVIDER_TYPE_OPTIONS.includes(trimmed)) return [trimmed];
  }

  return [];
}

function normalizeEducationLevels(input = []) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.filter((level) => EDUCATION_LEVEL_OPTIONS.includes(level)))];
}

function normalizeSubjectsTaught(input = []) {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  return [...new Set(rawValues.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizePhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  if (!raw) return '';

  let normalized = raw.replace(/[\s()+-]/g, '');
  if (normalized.startsWith('0')) normalized = `256${normalized.slice(1)}`;
  return normalized;
}

async function requireAdminUser(strapi, ctx) {
  const currentUser = await resolveAuthUser(strapi, ctx);
  if (!currentUser) {
    ctx.unauthorized();
    return null;
  }

  const withRole = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: currentUser.id },
    populate: ['role'],
  });
  const isAdmin = withRole?.role?.type === 'admin' || withRole?.role?.name === 'Admin';
  if (!isAdmin) {
    ctx.forbidden('Admin only');
    return null;
  }
  return withRole;
}

function userIsSeller(user) {
  const listedTypes = normalizeProviderTypes(user?.providerTypes);
  if (listedTypes.includes('seller')) return true;
  return normalizeProviderTypes(user?.providerType).includes('seller');
}

function normalizeNin(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isValidNin(value) {
  return /^[A-Z0-9]{8,20}$/.test(normalizeNin(value));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function finiteCoordinate(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveRequestedProviderType(currentUser, body) {
  const availableProviderTypes = normalizeProviderTypes(currentUser.providerTypes || currentUser.providerType);
  const fallback = currentUser.providerType || availableProviderTypes[0] || null;

  if (!PROVIDER_TYPE_OPTIONS.includes(body.providerType)) {
    return fallback;
  }

  if (!availableProviderTypes.length || availableProviderTypes.includes(body.providerType)) {
    return body.providerType;
  }

  return fallback;
}

module.exports = {
  async updateMe(ctx) {
    const currentUser = await resolveAuthUser(strapi, ctx);
    if (!currentUser) return ctx.unauthorized();

    const body = ctx.request.body?.data || ctx.request.body || {};
    const requestedProviderType = resolveRequestedProviderType(currentUser, body);
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const religion = RELIGION_OPTIONS.includes(body.religion) ? body.religion : null;
    const educationLevels = normalizeEducationLevels(body.educationLevels);
    const educationLevelOther = typeof body.educationLevelOther === 'string' ? body.educationLevelOther.trim() : '';
    const teacherBackground = typeof body.teacherBackground === 'string' ? body.teacherBackground.trim() : '';
    const teachingExperience = typeof body.teachingExperience === 'string' ? body.teachingExperience.trim() : '';
    const subjectsTaught = normalizeSubjectsTaught(body.subjectsTaught);
    const paymentPhone = typeof body.paymentPhone === 'string' ? body.paymentPhone.trim() : '';
    const paymentCode = typeof body.paymentCode === 'string' ? body.paymentCode.trim() : '';
    const contactPhone = typeof body.phone === 'string' ? normalizePhone(body.phone) : '';
    const whatsappNumber = typeof body.whatsappNumber === 'string' ? normalizePhone(body.whatsappNumber) : undefined;
    const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : null;

    if (!fullName) return ctx.badRequest('Full name is required');

    const updateData = { fullName };

    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    if (whatsappNumber !== undefined) {
      updateData.whatsappNumber = whatsappNumber || null;
    }

    const updatesTeacherProfile = ['schoolName', 'educationLevels', 'educationLevelOther', 'teacherBackground', 'teachingExperience', 'subjectsTaught']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key));
    const updatesReligion = Object.prototype.hasOwnProperty.call(body, 'religion');

    if (requestedProviderType === 'teacher' && updatesTeacherProfile) {
      if (!schoolName) return ctx.badRequest('School is required for teacher accounts');
      if (educationLevels.length === 0) return ctx.badRequest('Select at least one education level');
      if (educationLevels.includes('Other') && !educationLevelOther) {
        return ctx.badRequest('Enter the custom education level when selecting Other');
      }

      updateData.schoolName = schoolName;
      updateData.educationLevels = educationLevels;
      updateData.educationLevel = educationLevels[0] || null;
      updateData.educationLevelOther = educationLevels.includes('Other') ? educationLevelOther : null;
      updateData.teacherBackground = teacherBackground || null;
      updateData.teachingExperience = teachingExperience || null;
      updateData.subjectsTaught = subjectsTaught;
    }

    if (requestedProviderType === 'religious' && updatesReligion) {
      if (!religion) return ctx.badRequest('Religion is required for religious providers');
      updateData.religion = religion;
    }

    if (requestedProviderType === 'seller') {
      if (typeof body.location === 'string') {
        updateData.location = location || currentUser.location || 'Kampala';
      }
      if (typeof body.paymentPhone === 'string') {
        updateData.paymentPhone = paymentPhone || null;
      }
      if (typeof body.paymentCode === 'string') {
        updateData.paymentCode = paymentCode || null;
      }
      if (contactPhone) {
        updateData.phone = contactPhone;
      } else if (typeof body.paymentPhone === 'string' && paymentPhone) {
        updateData.phone = normalizePhone(paymentPhone) || null;
      }
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: updateData,
    });

    ctx.body = { data: updateData };
  },

  async submitSellerVerification(ctx) {
    const currentUser = await resolveAuthUser(strapi, ctx);
    if (!currentUser) return ctx.unauthorized();
    if (!userIsSeller(currentUser)) return ctx.forbidden('Only seller accounts can submit verification');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const incomingNinRaw = typeof body.nin === 'string' ? body.nin.trim() : '';
    const incomingNin = normalizeNin(body.nin);
    const storedNin = normalizeNin(currentUser.sellerNin);
    const nationalIdFrontUrl = typeof body.nationalIdFrontUrl === 'string' ? body.nationalIdFrontUrl.trim() : '';
    const nationalIdBackUrl = typeof body.nationalIdBackUrl === 'string' ? body.nationalIdBackUrl.trim() : '';

    let nin = storedNin;
    if (incomingNinRaw) {
      if (!isValidNin(incomingNin)) return ctx.badRequest('Enter a valid NIN using 8 to 20 letters or numbers');
      nin = incomingNin;
    }
    if (!isValidNin(nin)) return ctx.badRequest('Enter a valid NIN using 8 to 20 letters or numbers');
    if (!isHttpUrl(nationalIdFrontUrl)) return ctx.badRequest('Upload the front of your National ID');
    if (!isHttpUrl(nationalIdBackUrl)) return ctx.badRequest('Upload the back of your National ID');

    // A replacement always drops the badge until an admin approves the new photos.
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: {
        sellerNin: nin,
        sellerIdFrontUrl: nationalIdFrontUrl,
        sellerIdBackUrl: nationalIdBackUrl,
        sellerVerificationStatus: 'pending',
        sellerVerified: false,
      },
    });

    ctx.body = {
      data: {
        sellerVerified: false,
        sellerVerificationStatus: 'pending',
        hasSellerNin: true,
        hasNationalIdFront: true,
        hasNationalIdBack: true,
      },
    };
  },

  async listSellerVerifications(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const sellers = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: {
        $or: [
          { sellerVerificationStatus: { $in: ['pending', 'approved', 'rejected'] } },
          { sellerNin: { $notNull: true } },
        ],
      },
      select: [
        'id',
        'documentId',
        'username',
        'fullName',
        'phone',
        'email',
        'sellerNin',
        'sellerIdFrontUrl',
        'sellerIdBackUrl',
        'sellerVerified',
        'sellerVerificationStatus',
        'businessLatitude',
        'businessLongitude',
        'location',
        'updatedAt',
      ],
      orderBy: { updatedAt: 'desc' },
      limit: 200,
    });

    ctx.body = {
      data: (sellers || [])
        .filter((seller) => seller.sellerNin || seller.sellerIdFrontUrl || seller.sellerIdBackUrl)
        .map((seller) => ({
          id: seller.id,
          documentId: seller.documentId,
          name: seller.fullName || seller.username || seller.email || 'Seller',
          phone: seller.phone || null,
          nin: seller.sellerNin || '',
          nationalIdFrontUrl: seller.sellerIdFrontUrl || '',
          nationalIdBackUrl: seller.sellerIdBackUrl || '',
          sellerVerificationStatus: seller.sellerVerificationStatus === 'approved' && seller.sellerVerified
            ? 'approved'
            : seller.sellerVerificationStatus === 'rejected'
              ? 'rejected'
              : 'pending',
          businessLatitude: finiteCoordinate(seller.businessLatitude),
          businessLongitude: finiteCoordinate(seller.businessLongitude),
          location: seller.location || '',
          updatedAt: seller.updatedAt,
        })),
    };
  },

  async reviewSellerVerification(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const sellerId = Number(ctx.params.id);
    if (!Number.isFinite(sellerId)) return ctx.badRequest('Seller not found');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : '';
    if (!status) return ctx.badRequest('Choose approved or rejected');

    const seller = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: sellerId },
      select: ['id', 'sellerNin', 'sellerIdFrontUrl', 'sellerIdBackUrl'],
    });
    if (!seller) return ctx.notFound('Seller not found');
    if (status === 'approved' && (!seller.sellerNin || !seller.sellerIdFrontUrl || !seller.sellerIdBackUrl)) {
      return ctx.badRequest('This seller has not submitted a NIN and both National ID photos');
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: seller.id },
      data: {
        sellerVerificationStatus: status,
        sellerVerified: status === 'approved',
      },
    });

    ctx.body = {
      data: {
        id: seller.id,
        sellerVerificationStatus: status,
        sellerVerified: status === 'approved',
      },
    };
  },

  async updateSellerLocation(ctx) {
    const currentUser = await resolveAuthUser(strapi, ctx);
    if (!currentUser) return ctx.unauthorized();
    if (!userIsSeller(currentUser)) return ctx.forbidden('Only seller accounts can save a business location');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const latitude = finiteCoordinate(body.latitude);
    const longitude = finiteCoordinate(body.longitude);

    if (latitude == null || latitude < -90 || latitude > 90) {
      return ctx.badRequest('A valid latitude is required');
    }
    if (longitude == null || longitude < -180 || longitude > 180) {
      return ctx.badRequest('A valid longitude is required');
    }

    const businessLocationName = await reverseGeocodePlaceName(latitude, longitude).catch((error) => {
      strapi.log.warn(`Shop place name lookup failed: ${error.message}`);
      return '';
    });

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: {
        businessLatitude: latitude,
        businessLongitude: longitude,
        businessLocationName: businessLocationName || null,
      },
    });

    ctx.body = {
      data: {
        businessLatitude: latitude,
        businessLongitude: longitude,
        businessLocationName: businessLocationName || '',
      },
    };
  },

  async toggleTeacherSubscription(ctx) {
    const currentUser = await resolveAuthUser(strapi, ctx);
    if (!currentUser) return ctx.unauthorized();

    const viewer = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: currentUser.id },
      select: ['id', 'isParent', 'subscribedTeacherIds'],
    });

    if (!viewer?.isParent) {
      return ctx.forbidden('Only parent accounts can subscribe to teachers');
    }

    const teacherId = Number(ctx.params.id);
    if (!Number.isFinite(teacherId)) {
      return ctx.badRequest('Teacher not found');
    }

    const teacher = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        id: teacherId,
        accountType: { $in: ['provider', 'both'] },
        providerType: 'teacher',
      },
      select: ['id'],
    });

    if (!teacher) {
      return ctx.notFound('Teacher not found');
    }

    const currentSubscriptions = Array.isArray(viewer.subscribedTeacherIds)
      ? viewer.subscribedTeacherIds.map((value) => Number(value)).filter(Number.isFinite)
      : [];
    const isSubscribed = currentSubscriptions.includes(teacher.id);
    const nextSubscriptions = isSubscribed
      ? currentSubscriptions.filter((value) => value !== teacher.id)
      : [...currentSubscriptions, teacher.id];

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: viewer.id },
      data: { subscribedTeacherIds: nextSubscriptions },
    });

    ctx.body = {
      data: {
        teacherId: teacher.id,
        subscribed: !isSubscribed,
        subscribedTeacherIds: nextSubscriptions,
      },
    };
  },
};
