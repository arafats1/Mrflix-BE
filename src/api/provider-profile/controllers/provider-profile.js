'use strict';

const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { reverseGeocodePlaceName } = require('../../../utils/reverse-geocode');

const EDUCATION_LEVEL_OPTIONS = ['Kindergarten', 'Primary', 'Secondary', 'Technical college', 'University', 'Other'];
const RELIGION_OPTIONS = ['Catholic', 'Protestant', 'Pentecostal', 'Adventist', 'Orthodox', 'Muslim', 'Hindu', 'Bahai', 'Traditional', 'Other'];
const PROVIDER_TYPE_OPTIONS = ['teacher', 'religious', 'seller', 'musician', 'creative_artist', 'comedian'];
// Bump when the consent wording shown to sellers changes; clients send the
// version they displayed and it is stored with the acceptance time for audit.
const SELLER_CONSENT_VERSION = 'nira-crb-v1';

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

const SELLER_PAGE_SIZE = 50;
// Nominatim allows about one lookup per second, so name only a few missing
// places per request; the rest fill in on later loads.
const MAX_PLACE_LOOKUPS_PER_REQUEST = 5;

function hasSellerProviderType(user) {
  if (normalizeProviderTypes(user?.providerTypes).includes('seller')) return true;
  return normalizeProviderTypes(user?.providerType).includes('seller');
}

/** Ids of everyone who sells: tagged as a seller or owns at least one product. */
async function findSellerIds(strapi) {
  const ids = new Set();

  const productOwners = await strapi.db.connection('products_seller_lnk').distinct('user_id');
  for (const row of productOwners) {
    if (row.user_id != null) ids.add(Number(row.user_id));
  }

  const providers = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { $or: [{ providerType: { $notNull: true } }, { providerTypes: { $notNull: true } }] },
    select: ['id', 'providerType', 'providerTypes'],
  });
  for (const user of providers || []) {
    if (hasSellerProviderType(user)) ids.add(Number(user.id));
  }

  return [...ids];
}

/** Latest product description per seller, preferring published rows. */
async function findSampleProducts(strapi, sellerIds) {
  if (!sellerIds.length) return new Map();
  const rows = await strapi.db.connection('products as p')
    .join('products_seller_lnk as l', 'l.product_id', 'p.id')
    .whereIn('l.user_id', sellerIds)
    .select('l.user_id', 'p.document_id', 'p.name', 'p.description', 'p.published_at', 'p.created_at')
    .orderBy('p.created_at', 'desc');

  const bySeller = new Map();
  for (const row of rows) {
    const sellerId = Number(row.user_id);
    const entry = bySeller.get(sellerId) || { documentIds: new Set(), sample: null };
    if (row.published_at) entry.documentIds.add(row.document_id);
    const description = String(row.description || '').trim();
    const better = !entry.sample
      || (!entry.sample.description && description)
      || (description && row.published_at && !entry.sample.published);
    if (better) {
      entry.sample = { name: row.name || '', description, published: !!row.published_at };
    }
    bySeller.set(sellerId, entry);
  }

  const result = new Map();
  for (const [sellerId, entry] of bySeller) {
    result.set(sellerId, {
      productCount: entry.documentIds.size,
      productName: entry.sample?.name || '',
      productDescription: entry.sample?.description || '',
    });
  }
  return result;
}

function parseJsonColumn(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function productThumbnail(row) {
  const images = parseJsonColumn(row.images);
  const first = Array.isArray(images) ? images[0] : null;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return first.thumbnail || first.card || first.original || '';
  return row.featured_image || '';
}

/** One row per product, preferring the published copy of each document. */
async function findSellerProducts(strapi, sellerId) {
  const rows = await strapi.db.connection('products as p')
    .join('products_seller_lnk as l', 'l.product_id', 'p.id')
    .where('l.user_id', sellerId)
    .select(
      'p.document_id', 'p.name', 'p.description', 'p.price_ugx', 'p.currency', 'p.status',
      'p.category', 'p.images', 'p.featured_image', 'p.stock_quantity', 'p.published_at', 'p.created_at',
    )
    .orderBy('p.created_at', 'desc');

  const byDocument = new Map();
  for (const row of rows) {
    const existing = byDocument.get(row.document_id);
    if (existing && (existing.published_at || !row.published_at)) continue;
    byDocument.set(row.document_id, row);
  }

  return [...byDocument.values()].map((row) => ({
    documentId: row.document_id,
    name: row.name || 'Untitled product',
    description: String(row.description || '').trim(),
    priceUGX: Number(row.price_ugx) || 0,
    currency: row.currency || 'UGX',
    status: row.status || '',
    category: row.category || '',
    stockQuantity: row.stock_quantity,
    imageUrl: productThumbnail(row),
    published: !!row.published_at,
    createdAt: row.created_at,
  }));
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

  // Any signed-in user can list on the marketplace, so any of them can verify
  // their shop; buyer accounts that sell are not tagged with providerType.
  async submitSellerVerification(ctx) {
    const currentUser = await resolveAuthUser(strapi, ctx);
    if (!currentUser) return ctx.unauthorized();

    const body = ctx.request.body?.data || ctx.request.body || {};
    const incomingNinRaw = typeof body.nin === 'string' ? body.nin.trim() : '';
    const incomingNin = normalizeNin(body.nin);
    const storedNin = normalizeNin(currentUser.sellerNin);
    const nationalIdFrontUrl = typeof body.nationalIdFrontUrl === 'string' ? body.nationalIdFrontUrl.trim() : '';
    const nationalIdBackUrl = typeof body.nationalIdBackUrl === 'string' ? body.nationalIdBackUrl.trim() : '';
    const sellerPhotoUrl = typeof body.sellerPhotoUrl === 'string' ? body.sellerPhotoUrl.trim() : '';

    let nin = storedNin;
    if (incomingNinRaw) {
      if (!isValidNin(incomingNin)) return ctx.badRequest('Enter a valid NIN using 8 to 20 letters or numbers');
      nin = incomingNin;
    }
    if (!isValidNin(nin)) return ctx.badRequest('Enter a valid NIN using 8 to 20 letters or numbers');
    if (!isHttpUrl(nationalIdFrontUrl)) return ctx.badRequest('Upload the front of your National ID');
    if (!isHttpUrl(nationalIdBackUrl)) return ctx.badRequest('Upload the back of your National ID');
    if (!isHttpUrl(sellerPhotoUrl)) return ctx.badRequest('Upload a clear photo of yourself');
    if (body.consentAccepted !== true) {
      return ctx.badRequest('Tick the consent box to submit your NIN for verification');
    }
    if (body.consentVersion !== SELLER_CONSENT_VERSION) {
      return ctx.badRequest('The consent terms have changed. Refresh the page and review them again.');
    }

    // A replacement always drops the badge until an admin approves the new photos.
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: {
        sellerNin: nin,
        sellerIdFrontUrl: nationalIdFrontUrl,
        sellerIdBackUrl: nationalIdBackUrl,
        sellerPhotoUrl,
        sellerConsentAcceptedAt: new Date(),
        sellerConsentVersion: SELLER_CONSENT_VERSION,
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
        hasSellerPhoto: true,
      },
    };
  },

  async listSellers(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const page = Math.max(1, Number.parseInt(ctx.query.page, 10) || 1);
    const search = String(ctx.query.q || '').trim();
    const sellerIds = await findSellerIds(strapi);

    const where = { id: { $in: sellerIds.length ? sellerIds : [0] } };
    if (search) {
      where.$or = [
        { fullName: { $containsi: search } },
        { username: { $containsi: search } },
        { phone: { $containsi: search } },
        { sellerNin: { $containsi: search } },
      ];
    }

    const userQuery = strapi.db.query('plugin::users-permissions.user');
    const [sellers, total] = await Promise.all([
      userQuery.findMany({
        where,
        select: [
          'id', 'username', 'fullName', 'phone', 'whatsappNumber', 'avatarUrl', 'sellerNin',
          'sellerVerified', 'sellerVerificationStatus', 'businessLatitude', 'businessLongitude',
          'businessLocationName', 'location', 'createdAt',
        ],
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * SELLER_PAGE_SIZE,
        limit: SELLER_PAGE_SIZE,
      }),
      userQuery.count({ where }),
    ]);

    let lookups = 0;
    for (const seller of sellers) {
      const latitude = finiteCoordinate(seller.businessLatitude);
      const longitude = finiteCoordinate(seller.businessLongitude);
      if (latitude == null || longitude == null || String(seller.businessLocationName || '').trim()) continue;
      if (lookups >= MAX_PLACE_LOOKUPS_PER_REQUEST) break;
      lookups += 1;
      const name = await reverseGeocodePlaceName(latitude, longitude).catch(() => '');
      if (!name) continue;
      seller.businessLocationName = name;
      await userQuery.update({ where: { id: seller.id }, data: { businessLocationName: name } }).catch(() => {});
    }

    const products = await findSampleProducts(strapi, sellers.map((seller) => seller.id));

    ctx.body = {
      data: sellers.map((seller) => {
        const product = products.get(seller.id) || {};
        return {
          id: seller.id,
          name: seller.fullName || seller.username || 'Seller',
          phone: seller.phone || seller.whatsappNumber || '',
          nin: seller.sellerNin || '',
          avatarUrl: seller.avatarUrl || '',
          verified: seller.sellerVerificationStatus === 'approved' && seller.sellerVerified === true,
          verificationStatus: seller.sellerVerificationStatus || 'not_submitted',
          businessLatitude: finiteCoordinate(seller.businessLatitude),
          businessLongitude: finiteCoordinate(seller.businessLongitude),
          locationName: String(seller.businessLocationName || '').trim(),
          locationText: String(seller.location || '').trim(),
          productCount: product.productCount || 0,
          productName: product.productName || '',
          productDescription: product.productDescription || '',
          joinedAt: seller.createdAt,
        };
      }),
      meta: { page, pageSize: SELLER_PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / SELLER_PAGE_SIZE)) },
    };
  },

  async getSeller(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const id = Number.parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id)) return ctx.badRequest('Invalid seller id');

    const userQuery = strapi.db.query('plugin::users-permissions.user');
    const seller = await userQuery.findOne({
      where: { id },
      select: [
        'id', 'username', 'email', 'fullName', 'phone', 'whatsappNumber', 'avatarUrl', 'sellerNin',
        'sellerIdFrontUrl', 'sellerIdBackUrl', 'sellerPhotoUrl', 'sellerConsentAcceptedAt', 'sellerConsentVersion',
        'sellerVerified', 'sellerVerificationStatus', 'businessLatitude', 'businessLongitude',
        'businessLocationName', 'location', 'paymentPhone', 'paymentCode', 'providerType', 'createdAt',
      ],
    });
    if (!seller) return ctx.notFound('Seller not found');

    const latitude = finiteCoordinate(seller.businessLatitude);
    const longitude = finiteCoordinate(seller.businessLongitude);
    let locationName = String(seller.businessLocationName || '').trim();
    if (!locationName && latitude != null && longitude != null) {
      locationName = await reverseGeocodePlaceName(latitude, longitude).catch(() => '');
      if (locationName) {
        await userQuery.update({ where: { id }, data: { businessLocationName: locationName } }).catch(() => {});
      }
    }

    const products = await findSellerProducts(strapi, id);

    ctx.body = {
      data: {
        id: seller.id,
        name: seller.fullName || seller.username || 'Seller',
        username: seller.username || '',
        email: seller.email || '',
        phone: seller.phone || '',
        whatsappNumber: seller.whatsappNumber || '',
        paymentPhone: seller.paymentPhone || '',
        paymentCode: seller.paymentCode || '',
        providerType: seller.providerType || '',
        nin: seller.sellerNin || '',
        avatarUrl: seller.avatarUrl || '',
        nationalIdFrontUrl: seller.sellerIdFrontUrl || '',
        nationalIdBackUrl: seller.sellerIdBackUrl || '',
        sellerPhotoUrl: seller.sellerPhotoUrl || '',
        consentAcceptedAt: seller.sellerConsentAcceptedAt || null,
        consentVersion: seller.sellerConsentVersion || '',
        verified: seller.sellerVerificationStatus === 'approved' && seller.sellerVerified === true,
        verificationStatus: seller.sellerVerificationStatus || 'not_submitted',
        businessLatitude: latitude,
        businessLongitude: longitude,
        locationName,
        locationText: String(seller.location || '').trim(),
        joinedAt: seller.createdAt,
        products,
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
        'sellerPhotoUrl',
        'sellerConsentAcceptedAt',
        'sellerConsentVersion',
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
          sellerPhotoUrl: seller.sellerPhotoUrl || '',
          consentAcceptedAt: seller.sellerConsentAcceptedAt || null,
          consentVersion: seller.sellerConsentVersion || '',
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
