'use strict';

const { submitPayment, checkPaymentStatus: checkGatewayPaymentStatus } = require('../../../utils/payment-gateway');
const { activateHomesPaymentByFilter, failHomesPaymentByFilter } = require('../../../utils/homes-payments');

const LISTING_UID = 'api::home-listing.home-listing';
const KYC_UID = 'api::home-kyc.home-kyc';
const CONTACT_UID = 'api::home-contact-unlock.home-contact-unlock';
const BOOKING_UID = 'api::home-booking.home-booking';
const SAVE_UID = 'api::home-save.home-save';
const REVIEW_UID = 'api::home-review.home-review';
const REPORT_UID = 'api::home-report.home-report';

const LISTING_KINDS = ['rent', 'sale', 'stay'];
const OWNER_ROLES = ['landlord', 'broker', 'host'];
const STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'archived'];
const AVAILABILITY = ['available', 'taken'];

function bodyData(ctx) {
  return ctx.request.body?.data || ctx.request.body || {};
}

function cleanString(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function intValue(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 0) {
  return Math.max(0, intValue(value, fallback));
}

function floatValue(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeList(input) {
  if (Array.isArray(input)) return input.map((item) => cleanString(item, 120)).filter(Boolean);
  if (typeof input === 'string') return input.split(/[\n,]+/).map((item) => cleanString(item, 120)).filter(Boolean);
  return [];
}

function normalizeJsonArray(input) {
  return Array.isArray(input) ? input : [];
}

function normalizeKycDocuments(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const normalizeUrls = (value) => (Array.isArray(value) ? value.map((item) => cleanString(item, 1000)).filter(Boolean) : []);
  return {
    nationalIdImages: normalizeUrls(raw.nationalIdImages),
    ownershipProofImages: normalizeUrls(raw.ownershipProofImages),
    tenancyAgreementImages: normalizeUrls(raw.tenancyAgreementImages),
    phoneNumber: cleanString(raw.phoneNumber, 40),
    locationLabel: cleanString(raw.locationLabel, 160),
    latitude: floatValue(raw.latitude),
    longitude: floatValue(raw.longitude),
  };
}

function slugify(value) {
  return cleanString(value, 140).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+)|(-+$)/g, '') || `home-${Date.now()}`;
}

function isAdmin(user) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || user?.isApiTokenAdmin === true;
}

async function fullUser(userId) {
  if (!userId) return null;
  return strapi.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
}

async function authUser(ctx) {
  if (ctx.state.user?.id) {
    const current = ctx.state.user;
    const hydrated = await fullUser(current.id).catch(() => null);
    if (hydrated) {
      return {
        ...hydrated,
        role: hydrated.role || current.role,
        isApiTokenAdmin: hydrated.isApiTokenAdmin === true || current.isApiTokenAdmin === true,
      };
    }
    return current;
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!id) return null;
    return await fullUser(id);
  } catch {
    return null;
  }
}

async function findListing(identifier, populate = {}) {
  const raw = cleanString(identifier, 180);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const byId = await strapi.entityService.findOne(LISTING_UID, Number(raw), { populate }).catch(() => null);
    if (byId) return byId;
  }

  const found = await strapi.entityService.findMany(LISTING_UID, {
    filters: { $or: [{ slug: raw }, { documentId: raw }] },
    populate,
    limit: 1,
  });
  return found?.[0] || null;
}

async function hasApprovedKyc(userId, role) {
  if (!userId || !role) return false;
  const rows = await strapi.entityService.findMany(KYC_UID, {
    filters: { user: { id: userId }, role, status: 'approved' },
    limit: 1,
  });
  return rows?.length > 0;
}

async function hasSubmittedKyc(userId, role) {
  if (!userId || !role) return false;
  const rows = await strapi.entityService.findMany(KYC_UID, {
    filters: { user: { id: userId }, role, status: { $in: ['pending', 'approved'] } },
    limit: 1,
  });
  return rows?.length > 0;
}

function publicProvider(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username || '',
    fullName: user.fullName || '',
    email: user.email || '',
    phone: user.phone || '',
    location: user.location || '',
    homesRole: user.homesRole || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function hasActiveUnlock(userId, listingId) {
  if (!userId || !listingId) return false;
  const rows = await strapi.entityService.findMany(CONTACT_UID, {
    filters: { requester: { id: userId }, listing: { id: listingId }, status: 'active' },
    limit: 1,
  });
  return rows?.length > 0;
}

async function hasConfirmedBooking(userId, listingId) {
  if (!userId || !listingId) return false;
  const rows = await strapi.entityService.findMany(BOOKING_UID, {
    filters: { guest: { id: userId }, listing: { id: listingId }, status: 'confirmed' },
    limit: 1,
  });
  return rows?.length > 0;
}

async function getHomesContactUnlockFeeUGX() {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  const entry = Array.isArray(settings) ? settings[0] : settings;
  return positiveInt(entry?.homesContactUnlockFeeUGX, 10000);
}

function mergeKycPayload(existing, input) {
  const existingDocs = normalizeKycDocuments(existing?.documentImages);
  const inputDocs = normalizeKycDocuments(input.documentImages);
  const locationLabel = cleanString(inputDocs.locationLabel || existingDocs.locationLabel || input.location || existing?.location, 160);
  return {
    idNumber: cleanString(input.idNumber ?? existing?.idNumber, 80),
    businessName: cleanString(input.businessName ?? existing?.businessName, 140),
    location: cleanString(input.location || locationLabel || existing?.location, 140),
    documentImages: {
      nationalIdImages: inputDocs.nationalIdImages.length ? inputDocs.nationalIdImages : existingDocs.nationalIdImages,
      ownershipProofImages: inputDocs.ownershipProofImages.length ? inputDocs.ownershipProofImages : existingDocs.ownershipProofImages,
      tenancyAgreementImages: inputDocs.tenancyAgreementImages.length ? inputDocs.tenancyAgreementImages : existingDocs.tenancyAgreementImages,
      phoneNumber: cleanString(inputDocs.phoneNumber || existingDocs.phoneNumber, 40),
      locationLabel,
      latitude: Number.isFinite(inputDocs.latitude) ? inputDocs.latitude : existingDocs.latitude,
      longitude: Number.isFinite(inputDocs.longitude) ? inputDocs.longitude : existingDocs.longitude,
    },
  };
}

function getKycCompletion(role, payload) {
  const documents = normalizeKycDocuments(payload.documentImages);
  const idNumber = cleanString(payload.idNumber, 80);
  const businessName = cleanString(payload.businessName, 140);
  const location = cleanString(payload.location || documents.locationLabel, 140);
  const checks = [
    { key: 'idNumber', label: 'National ID', done: !!idNumber },
  ];
  if (role === 'broker') {
    checks.push({ key: 'businessName', label: 'Business name', done: !!businessName });
  } else if (role === 'host') {
    checks.push({ key: 'tenancyAgreement', label: 'Tenancy agreement', done: documents.tenancyAgreementImages.length > 0 });
  } else {
    checks.push({ key: 'ownershipProof', label: 'Proof of ownership', done: documents.ownershipProofImages.length > 0 });
  }
  checks.push(
    { key: 'location', label: 'Location on map', done: !!location && Number.isFinite(documents.latitude) && Number.isFinite(documents.longitude) },
    { key: 'phone', label: 'Active phone number', done: documents.phoneNumber.replace(/\D/g, '').length >= 10 },
  );
  const doneCount = checks.filter((item) => item.done).length;
  const percent = checks.length ? Math.round((doneCount / checks.length) * 100) : 0;
  return { checks, percent, complete: percent === 100 };
}

function shapeKycEntry(entry) {
  if (!entry) return entry;
  const completion = getKycCompletion(entry.role, {
    idNumber: entry.idNumber,
    businessName: entry.businessName,
    location: entry.location,
    documentImages: entry.documentImages,
  });
  const status = entry.status === 'approved' || completion.complete
    ? 'approved'
    : entry.status === 'rejected'
      ? 'rejected'
      : completion.percent > 0 || entry.idNumber || entry.location
        ? 'draft'
        : 'draft';
  return {
    id: entry.id,
    role: entry.role,
    status,
    completionPercent: completion.percent,
    checks: completion.checks,
    isVerified: status === 'approved',
    idNumber: entry.idNumber || '',
    businessName: entry.businessName || '',
    location: entry.location || '',
    documentImages: entry.documentImages || {},
    notes: entry.notes || '',
    reviewedAt: entry.reviewedAt || null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    user: entry.user ? publicProvider(entry.user) : entry.user,
    reviewer: entry.reviewer ? { id: entry.reviewer.id, username: entry.reviewer.username || '', fullName: entry.reviewer.fullName || '' } : null,
  };
}

async function syncListingVerificationForUser(userId, role, verificationStatus) {
  if (!userId || !role) return;
  const listings = await strapi.entityService.findMany(LISTING_UID, {
    filters: { owner: { id: userId }, ownerRole: role },
    limit: 500,
  });
  await Promise.all((listings || []).map((listing) => strapi.entityService.update(LISTING_UID, listing.id, { data: { verificationStatus } })));
}

function publicListing(listing, options = {}) {
  if (!listing) return listing;
  const canSeeContact = !!options.canSeeContact;
  const owner = listing.owner || null;
  return {
    id: listing.documentId || listing.slug || String(listing.id),
    numericId: listing.id,
    documentId: listing.documentId,
    slug: listing.slug,
    kind: listing.kind,
    status: listing.status,
    availabilityStatus: listing.availabilityStatus || 'available',
    title: listing.title,
    location: listing.location,
    addressHint: listing.addressHint || '',
    priceUGX: Number(listing.priceUGX || 0),
    priceLabel: listing.priceLabel || (listing.kind === 'stay' ? 'per night' : listing.kind === 'rent' ? 'per month' : 'asking price'),
    bedrooms: Number(listing.bedrooms || 0),
    bathrooms: Number(listing.bathrooms || 0),
    guests: Number(listing.guests || 1),
    sizeLabel: listing.sizeLabel || '',
    propertyType: listing.propertyType || '',
    description: listing.description || '',
    ownerName: listing.ownerName || owner?.fullName || owner?.username || 'Homes provider',
    ownerId: owner?.id || null,
    ownerDocumentId: owner?.documentId || null,
    ownerRole: listing.ownerRole,
    ownerPhone: canSeeContact ? (listing.ownerPhone || owner?.phone || null) : null,
    contactLocked: !canSeeContact,
    verificationStatus: listing.verificationStatus || 'pending',
    contactUnlockFeeUGX: Number(options.contactUnlockFeeUGX ?? listing.contactUnlockFeeUGX ?? 10000),
    visitFeeUGX: Number(listing.visitFeeUGX || 0),
    availableFrom: listing.availableFrom || '',
    amenities: Array.isArray(listing.amenities) ? listing.amenities : [],
    highlights: Array.isArray(listing.highlights) ? listing.highlights : [],
    sections: Array.isArray(listing.sections) ? listing.sections : [],
    rules: Array.isArray(listing.rules) ? listing.rules : [],
    rating: listing.rating ? Number(listing.rating) : null,
    reviews: Number(listing.reviews || 0),
    bookingCount: Number(listing.bookingCount || 0),
    availabilityDates: Array.isArray(listing.availabilityDates) ? listing.availabilityDates : [],
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

function listingInput(input, user, existing = {}) {
  const kind = LISTING_KINDS.includes(input.kind) ? input.kind : existing.kind || 'rent';
  const ownerRole = OWNER_ROLES.includes(input.ownerRole) ? input.ownerRole : existing.ownerRole || (kind === 'stay' ? 'host' : 'landlord');
  const title = cleanString(input.title || existing.title, 160);
  const status = STATUSES.includes(input.status) && isAdmin(user)
    ? input.status
    : existing.status || 'published';
  const availabilityStatus = AVAILABILITY.includes(input.availabilityStatus) ? input.availabilityStatus : existing.availabilityStatus || 'available';

  return {
    title,
    slug: cleanString(input.slug || existing.slug || slugify(title), 180),
    kind,
    status,
    availabilityStatus,
    location: cleanString(input.location || existing.location, 140),
    addressHint: cleanString(input.addressHint || existing.addressHint, 180),
    priceUGX: positiveInt(input.priceUGX ?? input.price ?? existing.priceUGX, existing.priceUGX || 0),
    priceLabel: cleanString(input.priceLabel || existing.priceLabel || (kind === 'stay' ? 'per night' : kind === 'rent' ? 'per month' : 'asking price'), 80),
    bedrooms: positiveInt(input.bedrooms ?? existing.bedrooms, existing.bedrooms || 0),
    bathrooms: positiveInt(input.bathrooms ?? existing.bathrooms, existing.bathrooms || 0),
    guests: Math.max(1, positiveInt(input.guests ?? existing.guests, existing.guests || 1)),
    sizeLabel: cleanString(input.sizeLabel || existing.sizeLabel, 80),
    propertyType: cleanString(input.propertyType || existing.propertyType, 80),
    description: cleanString(input.description || existing.description, 4000),
    ownerName: cleanString(input.ownerName || existing.ownerName || user?.fullName || user?.username, 120),
    ownerRole,
    ownerPhone: cleanString(input.ownerPhone || input.phone || existing.ownerPhone || user?.phone, 40),
    contactUnlockFeeUGX: positiveInt(input.contactUnlockFeeUGX ?? existing.contactUnlockFeeUGX, existing.contactUnlockFeeUGX || 10000),
    visitFeeUGX: positiveInt(input.visitFeeUGX ?? existing.visitFeeUGX, existing.visitFeeUGX || 5000),
    availableFrom: cleanString(input.availableFrom || existing.availableFrom, 120),
    amenities: normalizeList(input.amenities ?? existing.amenities),
    highlights: normalizeList(input.highlights ?? existing.highlights),
    sections: normalizeJsonArray(input.sections ?? existing.sections),
    rules: normalizeList(input.rules ?? existing.rules),
  };
}

function countListingPhotos(sections) {
  return normalizeJsonArray(sections).reduce((sum, section) => sum + (Array.isArray(section?.images) ? section.images.filter(Boolean).length : 0), 0);
}

function hasMeaningfulDraftInput(raw, shaped = {}) {
  const sections = normalizeJsonArray(raw.sections ?? shaped.sections);
  return Boolean(
    cleanString(raw.title ?? shaped.title, 160)
    || cleanString(raw.location ?? shaped.location, 140)
    || cleanString(raw.description ?? shaped.description, 4000)
    || cleanString(raw.propertyType ?? shaped.propertyType, 80)
    || positiveInt(raw.priceUGX ?? raw.price ?? shaped.priceUGX, 0) > 0
    || countListingPhotos(sections) > 0
  );
}

function applyDraftDefaults(input) {
  const kind = input.kind || 'rent';
  const title = input.title || 'Untitled listing';
  return {
    ...input,
    title,
    slug: input.slug || slugify(title),
    location: input.location || 'Draft location',
    propertyType: input.propertyType || (kind === 'stay' ? 'Entire home' : kind === 'sale' ? 'Other' : 'Apartment'),
    description: input.description || 'Draft listing',
  };
}

function validatePublishableListing(input) {
  if (!input.title || input.title === 'Untitled listing') return 'Add a title before publishing';
  if (!input.location || input.location === 'Draft location') return 'Add a location before publishing';
  if (!input.propertyType) return 'Property type is required';
  if (!input.description || input.description === 'Draft listing') return 'Add a description before publishing';
  if (!input.priceUGX) return 'Price is required';
  if (input.kind === 'sale' && !input.sizeLabel) return 'Size label is required for sale listings';
  if (countListingPhotos(input.sections) === 0) return 'Add at least one photo before publishing';
  return null;
}

function wantsDraftSave(raw) {
  return raw.saveDraft === true || raw.status === 'draft' || raw.publish === false;
}

function normalizeDateList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  for (const value of input) {
    const raw = cleanString(value, 20);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) seen.add(raw);
  }
  return Array.from(seen).sort();
}

function expandNights(checkIn, checkOut) {
  const dates = [];
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return dates;
  for (let cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

async function getBookedDates(listingId) {
  if (!listingId) return [];
  const bookings = await strapi.entityService.findMany(BOOKING_UID, {
    filters: { listing: { id: listingId }, status: { $in: ['confirmed', 'pending'] } },
    fields: ['checkIn', 'checkOut', 'status'],
    limit: 500,
  });
  const set = new Set();
  for (const booking of (bookings || [])) {
    if (!booking.checkIn || !booking.checkOut) continue;
    for (const date of expandNights(booking.checkIn, booking.checkOut)) set.add(date);
  }
  return Array.from(set).sort();
}

async function recomputeListingRating(listingId) {
  if (!listingId) return;
  const reviews = await strapi.entityService.findMany(REVIEW_UID, {
    filters: { listing: { id: listingId } },
    fields: ['rating'],
    limit: 1000,
  });
  const count = reviews?.length || 0;
  const avg = count ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count : 0;
  await strapi.entityService.update(LISTING_UID, listingId, {
    data: { reviews: count, rating: count ? Math.round(avg * 100) / 100 : null },
  }).catch((error) => strapi.log.warn(`[Homes] Could not update rating: ${error.message}`));
}

async function submitHomesPayment(ctx, record, amountUGX, prefix, description, paymentPhone) {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  const activeGateway = settings?.paymentGateway || 'pesapal';
  const ipnId = settings?.pesapalIpnId;

  if (activeGateway === 'pesapal' && !ipnId) return ctx.badRequest('Payment system not configured. Please contact support.');
  if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !paymentPhone) return ctx.badRequest('Phone number is required for mobile money payment.');

  const merchantReference = `${prefix}_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const updateData = { transactionId: merchantReference, paymentMethod: activeGateway, paymentPhone: paymentPhone || '' };

  const uid = prefix === 'HBOOK' ? BOOKING_UID : CONTACT_UID;
  await strapi.entityService.update(uid, record.id, { data: updateData });

  const nameParts = (ctx.state.user.fullName || ctx.state.user.username || '').split(' ');
  const frontendUrl = process.env.FRONTEND_URL || process.env.MRKEYP_URL || 'http://localhost:3000';
  const paymentResult = await submitPayment(strapi, {
    merchantReference,
    amount: amountUGX,
    description,
    callbackUrl: `${frontendUrl}/payment/callback`,
    ipnId,
    paymentPhone: paymentPhone || '',
    billingAddress: {
      email: ctx.state.user.email || '',
      phone: paymentPhone || ctx.state.user.phone || '',
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
    },
  });

  const paymentFields = {};
  if (paymentResult.gateway === 'pesapal') paymentFields.pesapalTrackingId = paymentResult.order_tracking_id;
  if (paymentResult.gateway === 'dgateway') paymentFields.dgatewayReference = paymentResult.reference;
  if (paymentResult.gateway === 'yo') paymentFields.yoReference = paymentResult.reference;
  await strapi.entityService.update(uid, record.id, { data: paymentFields });

  return {
    gateway: paymentResult.gateway,
    transactionId: merchantReference,
    redirect_url: paymentResult.redirect_url || null,
    order_tracking_id: paymentResult.order_tracking_id || null,
    reference: paymentResult.reference || null,
    paymentStatus: paymentResult.status || null,
  };
}

module.exports = {
  async findPublic(ctx) {
    const { kind, where, minPrice, maxPrice, bedrooms, propertyType, guests, page = 1, pageSize = 24 } = ctx.query || {};
    const filters = { status: 'published' };
    if (LISTING_KINDS.includes(kind)) filters.kind = kind;

    const rows = await strapi.entityService.findMany(LISTING_UID, {
      filters,
      populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName'] } },
      sort: { createdAt: 'desc' },
      limit: 500,
    });

    let data = rows || [];
    if (where) data = data.filter((item) => `${item.location || ''} ${item.addressHint || ''}`.toLowerCase().includes(String(where).toLowerCase()));
    if (minPrice) data = data.filter((item) => Number(item.priceUGX || 0) >= Number(minPrice));
    if (maxPrice) data = data.filter((item) => Number(item.priceUGX || 0) <= Number(maxPrice));
    if (bedrooms) data = data.filter((item) => Number(item.bedrooms || 0) === Number(bedrooms));
    if (propertyType) data = data.filter((item) => String(item.propertyType || '').toLowerCase() === String(propertyType).toLowerCase());
    if (guests) data = data.filter((item) => Number(item.guests || 1) >= Number(guests));

    const currentPage = Math.max(1, intValue(page, 1));
    const size = Math.min(100, Math.max(1, intValue(pageSize, 24)));
    const start = (currentPage - 1) * size;
    const paged = data.slice(start, start + size);

    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    return { data: paged.map((item) => publicListing(item, { contactUnlockFeeUGX })), meta: { pagination: { page: currentPage, pageSize: size, pageCount: Math.ceil(data.length / size), total: data.length } } };
  },

  async findOnePublic(ctx) {
    const user = await authUser(ctx);
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'phone'] } });
    if (!listing) return ctx.notFound('Listing not found');
    const isOwner = user?.id && Number(listing.owner?.id || 0) === Number(user.id);
    const canViewUnpublished = isOwner || isAdmin(user);
    if (listing.status !== 'published' && !canViewUnpublished) return ctx.notFound('Listing not found');

    const canSeeContact = !!(user?.id && (
      Number(listing.owner?.id || 0) === Number(user.id)
      || await hasActiveUnlock(user.id, listing.id)
      || (listing.kind === 'stay' && await hasConfirmedBooking(user.id, listing.id))
      || isAdmin(await fullUser(user.id))
    ));
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    return { data: publicListing(listing, { canSeeContact, contactUnlockFeeUGX }) };
  },

  async myListings(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const rows = await strapi.entityService.findMany(LISTING_UID, {
      filters: { owner: { id: ctx.state.user.id } },
      populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'phone'] } },
      sort: { createdAt: 'desc' },
      limit: 200,
    });
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    return { data: rows.map((item) => publicListing(item, { canSeeContact: true, contactUnlockFeeUGX })) };
  },

  async createListing(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const user = await fullUser(ctx.state.user.id);
    const raw = bodyData(ctx);
    const saveDraft = wantsDraftSave(raw);
    let input = listingInput(raw, user);
    if (saveDraft) {
      if (!hasMeaningfulDraftInput(raw, input)) return ctx.badRequest('Add at least one field before saving a draft');
      input = applyDraftDefaults(input);
      input.status = 'draft';
    } else {
      const publishError = validatePublishableListing(input);
      if (publishError) return ctx.badRequest(publishError);
      input.status = 'published';
    }

    input.verificationStatus = (await hasApprovedKyc(user.id, input.ownerRole)) ? 'verified' : 'pending';
    input.owner = user.id;
    input.contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    const created = await strapi.entityService.create(LISTING_UID, { data: input, populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'phone'] } } });
    const contactUnlockFeeUGX = input.contactUnlockFeeUGX;
    return { data: publicListing(created, { canSeeContact: true, contactUnlockFeeUGX }) };
  },

  async updateListing(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const user = await fullUser(ctx.state.user.id);
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id', 'phone', 'username', 'fullName'] } });
    if (!listing) return ctx.notFound('Listing not found');
    if (!isAdmin(user) && Number(listing.owner?.id || 0) !== Number(user.id)) return ctx.forbidden('You can only edit your own listings');

    const raw = bodyData(ctx);
    const saveDraft = wantsDraftSave(raw);
    const publishNow = raw.publish === true || raw.status === 'published';
    let input = listingInput(raw, user, listing);

    if (saveDraft) {
      if (!hasMeaningfulDraftInput(raw, input)) return ctx.badRequest('Add at least one field before saving a draft');
      input = applyDraftDefaults(input);
      input.status = 'draft';
    } else if (publishNow) {
      const publishError = validatePublishableListing(input);
      if (publishError) return ctx.badRequest(publishError);
      input.status = 'published';
    } else if (!isAdmin(user)) {
      input.status = listing.status || 'published';
    }

    input.verificationStatus = (await hasApprovedKyc(user.id, input.ownerRole)) ? 'verified' : (listing.verificationStatus || 'pending');
    input.contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();

    const updated = await strapi.entityService.update(LISTING_UID, listing.id, { data: input, populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'phone'] } } });
    const contactUnlockFeeUGX = input.contactUnlockFeeUGX;
    return { data: publicListing(updated, { canSeeContact: true, contactUnlockFeeUGX }) };
  },

  async setListingStatus(ctx) {
    const user = await authUser(ctx);
    if (!user) return ctx.unauthorized('Login required');
    const currentUser = ctx.state.user || {};
    const isAdminLike = isAdmin(user) || currentUser.role?.type === 'admin' || currentUser.role?.name === 'Admin';
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id', 'phone', 'username', 'fullName'] } });
    if (!listing) return ctx.notFound('Listing not found');
    if (!isAdminLike && Number(listing.owner?.id || 0) !== Number(user.id)) return ctx.forbidden('You can only manage your own listings');

    const action = cleanString(bodyData(ctx).action, 20);
    let status = listing.status;
    if (action === 'unpublish') {
      if (listing.status !== 'published') return ctx.badRequest('Only published listings can be unpublished');
      status = 'archived';
    } else if (action === 'publish') {
      const publishError = validatePublishableListing(listingInput(listing, user, listing));
      if (publishError) return ctx.badRequest(publishError);
      status = 'published';
    } else {
      return ctx.badRequest('Unknown action');
    }

    const updated = await strapi.entityService.update(LISTING_UID, listing.id, { data: { status }, populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'phone'] } } });
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    return { data: publicListing(updated, { canSeeContact: true, contactUnlockFeeUGX }) };
  },

  async deleteListing(ctx) {
    const user = await authUser(ctx);
    if (!user) return ctx.unauthorized('Login required');
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id'] } });
    if (!listing) return ctx.notFound('Listing not found');
    if (!isAdmin(user) && Number(listing.owner?.id || 0) !== Number(user.id)) return ctx.forbidden('You can only delete your own listings');
    await strapi.entityService.delete(LISTING_UID, listing.id);
    return { data: { id: listing.id, deleted: true } };
  },

  async homesAccount(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const user = await fullUser(ctx.state.user.id);
    return { data: { homesRole: user?.homesRole || null } };
  },

  async activateHomesAccount(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const requested = cleanString(bodyData(ctx).role, 20);
    const allowed = ['guest', 'landlord', 'broker', 'host'];
    if (!allowed.includes(requested)) return ctx.badRequest('Choose a valid Homes account type');

    const user = await fullUser(ctx.state.user.id);
    const current = user?.homesRole || null;
    // Providers should not be silently downgraded to guest; keep the stronger role.
    const providerRoles = ['landlord', 'broker', 'host'];
    let nextRole = requested;
    if (requested === 'guest' && providerRoles.includes(current)) nextRole = current;

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: ctx.state.user.id },
      data: { homesRole: nextRole },
    });
    return { data: { homesRole: nextRole } };
  },

  async submitKyc(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const input = bodyData(ctx);
    const isDraft = input.draft === true || input.saveDraft === true;
    const role = OWNER_ROLES.includes(input.role) ? input.role : 'landlord';
    const rows = await strapi.entityService.findMany(KYC_UID, { filters: { user: { id: ctx.state.user.id }, role }, limit: 1 });
    const existing = rows?.[0] || null;
    const merged = mergeKycPayload(existing, input);
    const completion = getKycCompletion(role, merged);

    if (!isDraft && !completion.complete) {
      return ctx.badRequest('Complete every verification requirement before submitting for the verified badge.');
    }

    const status = completion.complete ? 'approved' : 'draft';
    const data = {
      user: ctx.state.user.id,
      role,
      status,
      idNumber: merged.idNumber,
      businessName: merged.businessName,
      location: merged.location,
      documentImages: merged.documentImages,
    };
    const entry = existing
      ? await strapi.entityService.update(KYC_UID, existing.id, { data })
      : await strapi.entityService.create(KYC_UID, { data });

    await syncListingVerificationForUser(ctx.state.user.id, role, completion.complete ? 'verified' : 'pending');
    return { data: shapeKycEntry(entry) };
  },

  async myKyc(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const rows = await strapi.entityService.findMany(KYC_UID, { filters: { user: { id: ctx.state.user.id } }, sort: { createdAt: 'desc' } });
    return { data: (rows || []).map((entry) => shapeKycEntry(entry)) };
  },

  async reviewKyc(ctx) {
    const user = await authUser(ctx);
    if (!user) return ctx.unauthorized('Login required');
    if (!isAdmin(user)) return ctx.forbidden('Admin only');
    const input = bodyData(ctx);
    const status = ['approved', 'rejected', 'pending', 'draft'].includes(input.status) ? input.status : 'draft';
    const existing = await strapi.entityService.findOne(KYC_UID, ctx.params.id, { populate: { user: { fields: ['id'] } } });
    if (!existing) return ctx.notFound('KYC submission not found');
    const updated = await strapi.entityService.update(KYC_UID, ctx.params.id, { data: { status, notes: cleanString(input.notes, 1000), reviewer: user.id, reviewedAt: new Date().toISOString() } });

    if (existing.user?.id && existing.role) {
      const nextVerificationStatus = status === 'approved' ? 'verified' : 'pending';
      await syncListingVerificationForUser(existing.user.id, existing.role, nextVerificationStatus);
    }
    return { data: shapeKycEntry(updated) };
  },

  async adminOverview(ctx) {
    const user = await authUser(ctx);
    if (!user) return ctx.unauthorized('Login required');
    if (!isAdmin(user)) return ctx.forbidden('Admin only');

    const [providers, kycRows, listings] = await Promise.all([
      strapi.entityService.findMany('plugin::users-permissions.user', {
        filters: { homesRole: { $in: OWNER_ROLES } },
        populate: ['role'],
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
      strapi.entityService.findMany(KYC_UID, {
        populate: { user: { fields: ['id', 'username', 'fullName', 'email', 'phone', 'location', 'homesRole'] }, reviewer: { fields: ['id', 'username', 'fullName'] } },
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
      strapi.entityService.findMany(LISTING_UID, {
        populate: { owner: { fields: ['id', 'documentId', 'username', 'fullName', 'email', 'phone', 'location', 'homesRole'] } },
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
    ]);

    const shapedProviders = (providers || []).map((entry) => {
      const provider = publicProvider(entry);
      const roleKyc = (kycRows || []).find((row) => Number(row.user?.id || 0) === Number(entry.id) && row.role === entry.homesRole);
      const shapedKycRow = roleKyc ? shapeKycEntry({ ...roleKyc, user: roleKyc.user }) : null;
      return {
        ...provider,
        kycStatus: shapedKycRow?.status || 'not_started',
        completionPercent: shapedKycRow?.completionPercent || 0,
        isVerified: shapedKycRow?.isVerified === true,
      };
    });
    const shapedKyc = (kycRows || []).map((entry) => shapeKycEntry({ ...entry, user: entry.user }));
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    const shapedListings = (listings || []).map((entry) => publicListing(entry, { canSeeContact: true, contactUnlockFeeUGX }));

    return {
      data: {
        providers: shapedProviders,
        kyc: shapedKyc,
        listings: shapedListings,
        settings: { contactUnlockFeeUGX },
        stats: {
          providers: shapedProviders.length,
          verifiedProviders: shapedProviders.filter((entry) => entry.isVerified).length,
          unverifiedProviders: shapedProviders.filter((entry) => !entry.isVerified).length,
          draftKyc: shapedKyc.filter((entry) => entry.status === 'draft').length,
          approvedKyc: shapedKyc.filter((entry) => entry.status === 'approved').length,
          pendingKyc: shapedKyc.filter((entry) => entry.status === 'pending').length,
          pendingListings: shapedListings.filter((entry) => entry.status === 'pending_review').length,
          publishedListings: shapedListings.filter((entry) => entry.status === 'published').length,
        },
      },
    };
  },

  async unlockContact(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const input = bodyData(ctx);
    const listing = await findListing(ctx.params.id || input.listingId, { owner: { fields: ['id', 'phone', 'username', 'fullName'] } });
    if (!listing || listing.status !== 'published') return ctx.notFound('Listing not found');
    if (listing.availabilityStatus === 'taken') return ctx.badRequest('This property is fully occupied. Contact unlock is not available.');
    if (Number(listing.owner?.id || 0) === Number(ctx.state.user.id)) return ctx.badRequest('You already own this listing');

    const active = await strapi.entityService.findMany(CONTACT_UID, { filters: { requester: { id: ctx.state.user.id }, listing: { id: listing.id }, status: 'active' }, limit: 1 });
    if (active?.[0]) return { data: { unlock: active[0], ownerPhone: listing.ownerPhone || listing.owner?.phone || null, alreadyUnlocked: true } };

    const amount = await getHomesContactUnlockFeeUGX();
    const entry = await strapi.entityService.create(CONTACT_UID, {
      data: { listing: listing.id, requester: ctx.state.user.id, owner: listing.owner?.id || null, amountUGX: amount, paymentPhone: cleanString(input.paymentPhone, 40), status: amount > 0 ? 'pending' : 'active', unlockedAt: amount > 0 ? null : new Date().toISOString() },
    });
    if (amount <= 0) return { data: { unlock: entry, ownerPhone: listing.ownerPhone || listing.owner?.phone || null } };

    const payment = await submitHomesPayment(ctx, entry, amount, 'HCU', `Homes contact unlock: ${listing.title}`, cleanString(input.paymentPhone, 40));
    if (payment?.data || payment?.status) return payment;
    return { data: { unlockId: entry.id, ...payment } };
  },

  async createBooking(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const input = bodyData(ctx);
    const listing = await findListing(ctx.params.id || input.listingId, { owner: { fields: ['id', 'phone', 'username', 'fullName'] } });
    if (!listing || listing.status !== 'published' || listing.kind !== 'stay') return ctx.notFound('Short stay home not found');
    if (listing.availabilityStatus === 'taken') return ctx.badRequest('This property is fully occupied and not accepting bookings.');

    const checkIn = cleanString(input.checkIn, 20);
    const checkOut = cleanString(input.checkOut, 20);
    const inDate = new Date(`${checkIn}T00:00:00.000Z`);
    const outDate = new Date(`${checkOut}T00:00:00.000Z`);
    const nights = Math.ceil((outDate.getTime() - inDate.getTime()) / 86400000);
    if (!checkIn || !checkOut || !Number.isFinite(nights) || nights < 1) return ctx.badRequest('Valid check-in and checkout dates are required');

    const guests = Math.max(1, positiveInt(input.guests, 1));
    if (guests > Number(listing.guests || 1)) return ctx.badRequest('Guest count is above this home capacity');

    const requestedNights = expandNights(checkIn, checkOut);
    const bookedDates = await getBookedDates(listing.id);
    const clash = requestedNights.find((date) => bookedDates.includes(date));
    if (clash) return ctx.badRequest(`Some of those nights are already booked (${clash}). Please choose other dates.`);

    const availability = normalizeDateList(listing.availabilityDates);
    if (availability.length) {
      const unavailable = requestedNights.find((date) => !availability.includes(date));
      if (unavailable) return ctx.badRequest(`The host has not opened ${unavailable} for booking.`);
    }

    const amount = Number(listing.priceUGX || 0) * nights;
    const entry = await strapi.entityService.create(BOOKING_UID, {
      data: { listing: listing.id, guest: ctx.state.user.id, host: listing.owner?.id || null, checkIn, checkOut, guests, nights, amountUGX: amount, paymentPhone: cleanString(input.paymentPhone, 40), status: amount > 0 ? 'pending' : 'confirmed', specialRequests: cleanString(input.specialRequests, 1000) },
    });
    if (amount <= 0) return { data: { booking: entry } };

    const payment = await submitHomesPayment(ctx, entry, amount, 'HBOOK', `Homes booking: ${listing.title}`, cleanString(input.paymentPhone, 40));
    if (payment?.data || payment?.status) return payment;
    return { data: { bookingId: entry.id, ...payment } };
  },

  async reportListing(ctx) {
    const input = bodyData(ctx);
    const listing = await findListing(ctx.params.id || input.listingId, { owner: { fields: ['id'] } });
    if (!listing) return ctx.notFound('Listing not found');
    const reason = cleanString(input.reason, 160);
    if (!reason) return ctx.badRequest('A reason is required');
    const reporterId = ctx.state.user?.id || null;
    const entry = await strapi.entityService.create(REPORT_UID, {
      data: {
        listing: listing.id,
        owner: listing.owner?.id || null,
        reporter: reporterId,
        reason,
        details: cleanString(input.details, 2000),
        reporterName: cleanString(input.reporterName, 120),
        reporterPhone: cleanString(input.reporterPhone, 40),
        status: 'open',
      },
    });
    return { data: { id: entry.id, status: entry.status } };
  },

  async myReports(ctx) {
    const user = await authUser(ctx);
    if (!user) return ctx.unauthorized('Login required');
    const filters = isAdmin(user) ? {} : { owner: { id: user.id } };
    const rows = await strapi.entityService.findMany(REPORT_UID, {
      filters,
      populate: {
        listing: { fields: ['id', 'documentId', 'slug', 'title', 'location', 'kind'] },
        reporter: { fields: ['id', 'username', 'fullName', 'phone'] },
      },
      sort: { createdAt: 'desc' },
      limit: 500,
    });
    return {
      data: (rows || []).map((row) => ({
        id: row.id,
        reason: row.reason,
        details: row.details || '',
        reporterName: row.reporterName || row.reporter?.fullName || row.reporter?.username || 'Anonymous',
        reporterPhone: row.reporterPhone || row.reporter?.phone || '',
        status: row.status,
        createdAt: row.createdAt,
        listing: row.listing ? { id: row.listing.documentId || row.listing.slug || String(row.listing.id), title: row.listing.title, location: row.listing.location, kind: row.listing.kind } : null,
      })),
    };
  },

  async myBookings(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const rows = await strapi.entityService.findMany(BOOKING_UID, {
      filters: { $or: [{ guest: { id: ctx.state.user.id } }, { host: { id: ctx.state.user.id } }] },
      populate: { listing: true, guest: { fields: ['id', 'username', 'fullName', 'phone'] }, host: { fields: ['id', 'username', 'fullName', 'phone'] } },
      sort: { createdAt: 'desc' },
      limit: 200,
    });
    return { data: rows };
  },

  async toggleSave(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const listing = await findListing(ctx.params.id, {});
    if (!listing || listing.status !== 'published') return ctx.notFound('Listing not found');

    const rows = await strapi.entityService.findMany(SAVE_UID, { filters: { user: { id: ctx.state.user.id }, listing: { id: listing.id } }, limit: 1 });
    if (rows?.[0]) {
      await strapi.entityService.delete(SAVE_UID, rows[0].id);
      return { data: { saved: false } };
    }
    const saved = await strapi.entityService.create(SAVE_UID, { data: { user: ctx.state.user.id, listing: listing.id } });
    return { data: { saved: true, save: saved } };
  },

  async mySaves(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const rows = await strapi.entityService.findMany(SAVE_UID, { filters: { user: { id: ctx.state.user.id } }, populate: { listing: true }, sort: { createdAt: 'desc' } });
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    return { data: rows.map((row) => ({ ...row, listing: publicListing(row.listing, { contactUnlockFeeUGX }) })) };
  },

  async checkPaymentStatus(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const { transactionId } = ctx.query || {};
    if (!transactionId) return ctx.badRequest('transactionId is required');

    const filters = { transactionId, $or: [{ requester: { id: ctx.state.user.id } }, { guest: { id: ctx.state.user.id } }] };
    const [unlocks, bookings] = await Promise.all([
      strapi.entityService.findMany(CONTACT_UID, { filters: { transactionId, requester: { id: ctx.state.user.id } }, limit: 1 }),
      strapi.entityService.findMany(BOOKING_UID, { filters: { transactionId, guest: { id: ctx.state.user.id } }, limit: 1 }),
    ]);
    const record = unlocks?.[0] || bookings?.[0];
    if (!record) return ctx.notFound('Homes payment not found');

    if (record.status === 'pending' && (record.pesapalTrackingId || record.dgatewayReference || record.yoReference)) {
      try {
        const gatewayResult = await checkGatewayPaymentStatus(strapi, {
          pesapalTrackingId: record.pesapalTrackingId,
          dgatewayReference: record.dgatewayReference,
          yoReference: record.yoReference,
          gateway: record.yoReference ? 'yo' : record.dgatewayReference ? 'dgateway' : 'pesapal',
          merchantReference: transactionId,
        });
        if (gatewayResult.status === 'completed') await activateHomesPaymentByFilter(strapi, { transactionId }, gatewayResult.paymentMethod || record.paymentMethod);
        if (gatewayResult.status === 'failed') await failHomesPaymentByFilter(strapi, { transactionId });
      } catch (error) {
        strapi.log.warn(`[Homes payment status] gateway check failed: ${error.message}`);
      }
    }

    const [updatedUnlocks, updatedBookings] = await Promise.all([
      strapi.entityService.findMany(CONTACT_UID, { filters: { transactionId, requester: { id: ctx.state.user.id } }, limit: 1 }),
      strapi.entityService.findMany(BOOKING_UID, { filters: { transactionId, guest: { id: ctx.state.user.id } }, limit: 1 }),
    ]);
    return { data: updatedUnlocks?.[0] || updatedBookings?.[0] || record };
  },

  async getAvailability(ctx) {
    const listing = await findListing(ctx.params.id, {});
    if (!listing || listing.status !== 'published') return ctx.notFound('Listing not found');
    return { data: { availableDates: normalizeDateList(listing.availabilityDates), bookedDates: await getBookedDates(listing.id) } };
  },

  async setAvailability(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const user = await fullUser(ctx.state.user.id);
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id'] } });
    if (!listing) return ctx.notFound('Listing not found');
    if (!isAdmin(user) && Number(listing.owner?.id || 0) !== Number(user.id)) return ctx.forbidden('You can only manage your own listings');

    const availabilityDates = normalizeDateList(bodyData(ctx).availableDates);
    await strapi.entityService.update(LISTING_UID, listing.id, { data: { availabilityDates } });
    return { data: { availableDates: availabilityDates, bookedDates: await getBookedDates(listing.id) } };
  },

  async ownerProfile(ctx) {
    const ownerId = intValue(ctx.params.id, 0);
    if (!ownerId) return ctx.badRequest('Owner id is required');
    const owner = await strapi.entityService.findOne('plugin::users-permissions.user', ownerId, { fields: ['id', 'username', 'fullName', 'location', 'country', 'createdAt'] });
    if (!owner) return ctx.notFound('Owner not found');

    const listings = await strapi.entityService.findMany(LISTING_UID, {
      filters: { owner: { id: ownerId }, status: 'published' },
      populate: { owner: { fields: ['id', 'username', 'fullName'] } },
      sort: { createdAt: 'desc' },
      limit: 200,
    });
    const contactUnlockFeeUGX = await getHomesContactUnlockFeeUGX();
    const shaped = (listings || []).map((item) => publicListing(item, { contactUnlockFeeUGX }));
    const verified = shaped.some((item) => item.verificationStatus === 'verified');
    const roles = Array.from(new Set(shaped.map((item) => item.ownerRole).filter(Boolean)));
    return {
      data: {
        id: owner.id,
        name: owner.fullName || owner.username || 'Homes provider',
        location: owner.location || '',
        country: owner.country || '',
        memberSince: owner.createdAt,
        roles,
        verified,
        listingCount: shaped.length,
        listings: shaped,
      },
    };
  },

  async listReviews(ctx) {
    const listing = await findListing(ctx.params.id, {});
    if (!listing) return ctx.notFound('Listing not found');
    const reviews = await strapi.entityService.findMany(REVIEW_UID, {
      filters: { listing: { id: listing.id } },
      populate: { user: { fields: ['id', 'username', 'fullName'] } },
      sort: { createdAt: 'desc' },
      limit: 200,
    });
    const count = reviews?.length || 0;
    const avg = count ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count : 0;
    return {
      data: (reviews || []).map((review) => ({
        id: review.id,
        rating: Number(review.rating || 0),
        comment: review.comment || '',
        authorName: review.authorName || review.user?.fullName || review.user?.username || 'Guest',
        authorId: review.user?.id || null,
        createdAt: review.createdAt,
      })),
      meta: { count, average: count ? Math.round(avg * 100) / 100 : null },
    };
  },

  async createReview(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const user = await fullUser(ctx.state.user.id);
    const listing = await findListing(ctx.params.id, { owner: { fields: ['id'] } });
    if (!listing || listing.status !== 'published') return ctx.notFound('Listing not found');
    if (Number(listing.owner?.id || 0) === Number(user.id)) return ctx.badRequest('You cannot review your own listing');

    const input = bodyData(ctx);
    const rating = Math.min(5, Math.max(1, intValue(input.rating, 0)));
    if (!rating) return ctx.badRequest('A star rating between 1 and 5 is required');
    const comment = cleanString(input.comment, 2000);

    const existing = await strapi.entityService.findMany(REVIEW_UID, { filters: { listing: { id: listing.id }, user: { id: user.id } }, limit: 1 });
    const data = { listing: listing.id, user: user.id, rating, comment, authorName: user.fullName || user.username || 'Guest' };
    const review = existing?.[0]
      ? await strapi.entityService.update(REVIEW_UID, existing[0].id, { data })
      : await strapi.entityService.create(REVIEW_UID, { data });
    await recomputeListingRating(listing.id);
    return { data: { id: review.id, rating: review.rating, comment: review.comment, authorName: review.authorName, createdAt: review.createdAt } };
  },
};