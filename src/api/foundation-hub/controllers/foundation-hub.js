'use strict';

const crypto = require('crypto');
const {
  notifyDonorNewRequest,
  notifyBeneficiaryRequestApproved,
  notifyDonorItemReceived,
  notifyBeneficiaryFundraiserPledge,
} = require('../../../utils/foundation-notifications');

const PROFILE_UID = 'api::foundation-profile.foundation-profile';
const ITEM_UID = 'api::foundation-item.foundation-item';
const APPLICATION_UID = 'api::foundation-application.foundation-application';
const FUNDRAISER_UID = 'api::foundation-fundraiser.foundation-fundraiser';
const PLEDGE_UID = 'api::foundation-fundraiser-pledge.foundation-fundraiser-pledge';
const COMMENT_UID = 'api::foundation-fundraiser-comment.foundation-fundraiser-comment';

const FOUNDATION_ROLES = ['donor', 'beneficiary'];
const ITEM_CONDITIONS = ['new', 'used', 'refurbished', 'good_condition'];
const ITEM_STATUSES = ['available', 'partially_booked', 'booked', 'completed'];
const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'booked', 'received'];

function bodyData(ctx) {
  return ctx.request.body?.data || ctx.request.body || {};
}

function cleanString(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function intValue(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, intValue(value, fallback));
}

function nonNegativeInt(value, fallback = 0) {
  return Math.max(0, intValue(value, fallback));
}

function parseAmountUGX(value) {
  if (value === undefined || value === null || value === '') return 0;
  const digits = String(value).replace(/\D/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function fundraiserGoalFlags(row = {}) {
  const targetQuantity = nonNegativeInt(row.targetQuantity, 0);
  const targetAmountUGX = parseAmountUGX(row.targetAmountUGX);
  const fundraiseItems = row.fundraiseItems === true || (row.fundraiseItems !== false && targetQuantity > 0);
  const fundraiseMoney = row.fundraiseMoney === true || parseAmountUGX(row.targetAmountUGX) > 0;
  return { fundraiseItems, fundraiseMoney, targetQuantity, targetAmountUGX };
}

function fundraiserProgress(row = {}) {
  const { fundraiseItems, fundraiseMoney, targetQuantity, targetAmountUGX } = fundraiserGoalFlags(row);
  const quantityFulfilled = nonNegativeInt(row.quantityFulfilled, 0);
  const amountFulfilledUGX = parseAmountUGX(row.amountFulfilledUGX);
  const quantityRemaining = fundraiseItems ? Math.max(0, targetQuantity - quantityFulfilled) : 0;
  const amountRemainingUGX = fundraiseMoney ? Math.max(0, targetAmountUGX - amountFulfilledUGX) : 0;
  const itemsGoalMet = !fundraiseItems || quantityRemaining <= 0;
  const moneyGoalMet = !fundraiseMoney || amountRemainingUGX <= 0;
  return {
    fundraiseItems,
    fundraiseMoney,
    targetQuantity,
    targetAmountUGX,
    quantityFulfilled,
    amountFulfilledUGX,
    quantityRemaining,
    amountRemainingUGX,
    canPledgeItems: fundraiseItems && quantityRemaining > 0,
    canPledgeMoney: fundraiseMoney && amountRemainingUGX > 0,
    goalFulfilled: itemsGoalMet && moneyGoalMet,
  };
}

function normalizeMediaUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const cleaned = cleanString(value, 1000);
    return cleaned && cleaned !== '[object Object]' ? cleaned : null;
  }
  if (typeof value === 'object' && typeof value.url === 'string') {
    return cleanString(value.url, 1000) || null;
  }
  return null;
}

function normalizeUrls(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => normalizeMediaUrl(item)).filter(Boolean);
}

function slugify(value) {
  return cleanString(value, 140).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+)|(-+$)/g, '') || `fundraiser-${Date.now()}`;
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
    const hydrated = await fullUser(ctx.state.user.id).catch(() => null);
    return hydrated || ctx.state.user;
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

async function requireUser(ctx) {
  const user = await authUser(ctx);
  if (!user) {
    ctx.unauthorized('Login required');
    return null;
  }
  return user;
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    documentId: user.documentId,
    fullName: user.fullName || user.username,
    email: user.email,
    phone: user.phone || null,
    foundationRole: user.foundationRole || null,
  };
}

function serializeProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    documentId: profile.documentId,
    accountKind: profile.accountKind || 'individual',
    profilePhotoUrl: normalizeMediaUrl(profile.profilePhotoUrl),
    organizationName: profile.organizationName || null,
    affiliationGroup: profile.affiliationGroup || null,
    affiliationGroupOther: profile.affiliationGroupOther || null,
    institutionCategory: profile.institutionCategory || null,
    institutionCategoryOther: profile.institutionCategoryOther || null,
    contactPersonName: profile.contactPersonName || null,
    contactPersonPhone: profile.contactPersonPhone || null,
    contactPersonEmail: profile.contactPersonEmail || null,
    bio: profile.bio || null,
    user: serializeUser(profile.user),
  };
}

function itemDisplayName(item) {
  if (item.customItemName) return item.customItemName;
  return item.category || 'Item';
}

function serializeItem(item, { includeDonor = false } = {}) {
  if (!item) return null;
  const payload = {
    id: item.id,
    documentId: item.documentId,
    batchId: item.batchId,
    category: item.category,
    customItemName: item.customItemName || null,
    displayName: itemDisplayName(item),
    condition: item.condition,
    quantityTotal: item.quantityTotal,
    quantityAvailable: item.quantityAvailable,
    details: item.details || null,
    photos: normalizeUrls(item.photos),
    status: item.status,
    createdAt: item.createdAt,
  };
  if (includeDonor && item.donor) {
    payload.donor = serializeUser(item.donor);
  }
  return payload;
}

function serializeApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.documentId,
    quantityRequested: row.quantityRequested,
    quantityApproved: row.quantityApproved,
    message: row.message || null,
    photos: normalizeUrls(row.photos),
    pickupLocation: row.pickupLocation || null,
    pickupPhone: row.pickupPhone || null,
    receivedAt: row.receivedAt || null,
    status: row.status,
    createdAt: row.createdAt,
    item: serializeItem(row.item, { includeDonor: true }),
    beneficiary: serializeUser(row.beneficiary),
  };
}

function serializeFundraiser(row, { includeCreator = false } = {}) {
  if (!row) return null;
  const progress = fundraiserProgress(row);
  const payload = {
    id: row.id,
    documentId: row.documentId,
    title: row.title,
    slug: row.slug,
    description: row.description,
    fundraiseItems: progress.fundraiseItems,
    fundraiseMoney: progress.fundraiseMoney,
    targetQuantity: progress.targetQuantity,
    targetAmountUGX: progress.targetAmountUGX,
    quantityFulfilled: progress.quantityFulfilled,
    amountFulfilledUGX: progress.amountFulfilledUGX,
    quantityRemaining: progress.quantityRemaining,
    amountRemainingUGX: progress.amountRemainingUGX,
    canPledgeItems: progress.canPledgeItems,
    canPledgeMoney: progress.canPledgeMoney,
    goalFulfilled: progress.goalFulfilled,
    status: row.status,
    photos: normalizeUrls(row.photos),
    createdAt: row.createdAt,
  };
  if (includeCreator && row.creator) payload.creator = serializeUser(row.creator);
  return payload;
}

async function findProfileByUser(userId) {
  const rows = await strapi.entityService.findMany(PROFILE_UID, {
    filters: { user: userId },
    populate: { user: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    limit: 1,
  });
  return rows?.[0] || null;
}

async function ensureProfile(user, data = {}) {
  const existing = await findProfileByUser(user.id);
  if (existing) return existing;

  return strapi.entityService.create(PROFILE_UID, {
    data: {
      user: user.id,
      accountKind: ['individual', 'company'].includes(data.accountKind) ? data.accountKind : 'individual',
      organizationName: cleanString(data.organizationName, 200) || null,
      affiliationGroup: cleanString(data.affiliationGroup, 200) || null,
      affiliationGroupOther: cleanString(data.affiliationGroupOther, 200) || null,
      institutionCategory: cleanString(data.institutionCategory, 120) || null,
      institutionCategoryOther: cleanString(data.institutionCategoryOther, 200) || null,
      contactPersonName: cleanString(data.contactPersonName, 120) || null,
      contactPersonPhone: cleanString(data.contactPersonPhone, 40) || null,
      contactPersonEmail: cleanString(data.contactPersonEmail, 160) || null,
    },
    populate: { user: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
  });
}

async function findItemById(id) {
  const raw = cleanString(id, 80);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const byId = await strapi.entityService.findOne(ITEM_UID, Number(raw), {
      populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    }).catch(() => null);
    if (byId) return byId;
  }

  const rows = await strapi.entityService.findMany(ITEM_UID, {
    filters: { documentId: raw },
    populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    limit: 1,
  });
  return rows?.[0] || null;
}

async function findFundraiserById(id) {
  const raw = cleanString(id, 80);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const byId = await strapi.entityService.findOne(FUNDRAISER_UID, Number(raw), {
      populate: { creator: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    }).catch(() => null);
    if (byId) return byId;
  }

  const rows = await strapi.entityService.findMany(FUNDRAISER_UID, {
    filters: { $or: [{ documentId: raw }, { slug: raw }] },
    populate: { creator: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    limit: 1,
  });
  return rows?.[0] || null;
}

function computeItemStatus(item) {
  const available = intValue(item.quantityAvailable, 0);
  const total = intValue(item.quantityTotal, 0);
  if (available <= 0) return 'booked';
  if (available < total) return 'partially_booked';
  return 'available';
}

async function syncFundraiserStatus(fundraiserId) {
  const fundraiser = await strapi.entityService.findOne(FUNDRAISER_UID, fundraiserId);
  if (!fundraiser) return;

  const progress = fundraiserProgress(fundraiser);
  const nextStatus = progress.goalFulfilled
    ? 'completed'
    : fundraiser.status === 'archived'
      ? 'archived'
      : 'active';

  if (nextStatus !== fundraiser.status) {
    await strapi.entityService.update(FUNDRAISER_UID, fundraiserId, { data: { status: nextStatus } });
  }
}

function parseFundraiserGoals(data = {}, existing = null) {
  const fundraiseItems = data.fundraiseItems !== undefined ? !!data.fundraiseItems : (existing ? fundraiserGoalFlags(existing).fundraiseItems : true);
  const fundraiseMoney = data.fundraiseMoney !== undefined ? !!data.fundraiseMoney : (existing ? fundraiserGoalFlags(existing).fundraiseMoney : false);
  const targetQuantity = fundraiseItems
    ? positiveInt(data.targetQuantity !== undefined ? data.targetQuantity : existing?.targetQuantity, 1)
    : 0;
  const targetAmountUGX = fundraiseMoney
    ? positiveInt(data.targetAmountUGX !== undefined ? parseAmountUGX(data.targetAmountUGX) : parseAmountUGX(existing?.targetAmountUGX), 1)
    : 0;

  if (!fundraiseItems && !fundraiseMoney) {
    return { error: 'Select at least one goal: items, money, or both.' };
  }
  if (fundraiseItems && targetQuantity < 1) {
    return { error: 'Enter a target quantity for items.' };
  }
  if (fundraiseMoney && targetAmountUGX < 1) {
    return { error: 'Enter a target amount for money.' };
  }

  return {
    fundraiseItems,
    fundraiseMoney,
    targetQuantity,
    targetAmountUGX,
  };
}

module.exports = {
  async foundationAccount(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;

    const profile = await findProfileByUser(user.id);
    return {
      data: {
        foundationRole: user.foundationRole || null,
        profile: serializeProfile(profile),
      },
    };
  },

  async activateFoundationAccount(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;

    const data = bodyData(ctx);
    const role = FOUNDATION_ROLES.includes(data.role) ? data.role : null;
    if (!role) return ctx.badRequest('Select donor or beneficiary role');

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { foundationRole: role },
    });

    const profile = await ensureProfile(user, data);

    return {
      data: {
        foundationRole: role,
        profile: serializeProfile(profile),
      },
    };
  },

  async myProfile(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;

    const profile = await findProfileByUser(user.id);
    return { data: serializeProfile(profile) };
  },

  async updateProfile(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;

    if (!user.foundationRole) return ctx.forbidden('Activate a Foundation account first');

    const data = bodyData(ctx);
    const profile = await ensureProfile(user, data);
    const update = {};

    if (['individual', 'company'].includes(data.accountKind)) update.accountKind = data.accountKind;
    if (data.profilePhotoUrl !== undefined) update.profilePhotoUrl = normalizeMediaUrl(data.profilePhotoUrl);
    if (data.organizationName !== undefined) update.organizationName = cleanString(data.organizationName, 200) || null;
    if (data.affiliationGroup !== undefined) update.affiliationGroup = cleanString(data.affiliationGroup, 200) || null;
    if (data.affiliationGroupOther !== undefined) update.affiliationGroupOther = cleanString(data.affiliationGroupOther, 200) || null;
    if (data.institutionCategory !== undefined) update.institutionCategory = cleanString(data.institutionCategory, 120) || null;
    if (data.institutionCategoryOther !== undefined) update.institutionCategoryOther = cleanString(data.institutionCategoryOther, 200) || null;
    if (data.contactPersonName !== undefined) update.contactPersonName = cleanString(data.contactPersonName, 120) || null;
    if (data.contactPersonPhone !== undefined) update.contactPersonPhone = cleanString(data.contactPersonPhone, 40) || null;
    if (data.contactPersonEmail !== undefined) update.contactPersonEmail = cleanString(data.contactPersonEmail, 160) || null;
    if (data.bio !== undefined) update.bio = cleanString(data.bio, 3000) || null;

    const updated = Object.keys(update).length
      ? await strapi.entityService.update(PROFILE_UID, profile.id, {
        data: update,
        populate: { user: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
      })
      : profile;

    return { data: serializeProfile(updated) };
  },

  async listItems(ctx) {
    const status = cleanString(ctx.query?.status, 40);
    const donorId = intValue(ctx.query?.donorId, 0);
    const filters = {
      status: { $in: ['available', 'partially_booked', 'booked'] },
    };
    if (status && ITEM_STATUSES.includes(status)) filters.status = status;
    if (donorId > 0) filters.donor = donorId;

    const rows = await strapi.entityService.findMany(ITEM_UID, {
      filters,
      sort: { createdAt: 'desc' },
      populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
      limit: Math.min(100, positiveInt(ctx.query?.limit, 50)),
    });

    return { data: (rows || []).map((row) => serializeItem(row, { includeDonor: true })) };
  },

  async findItem(ctx) {
    const item = await findItemById(ctx.params.id);
    if (!item) return ctx.notFound('Item not found');
    return { data: serializeItem(item, { includeDonor: true }) };
  },

  async myItems(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const rows = await strapi.entityService.findMany(ITEM_UID, {
      filters: { donor: user.id },
      sort: { createdAt: 'desc' },
      limit: 200,
    });

    return { data: (rows || []).map((row) => serializeItem(row)) };
  },

  async createItems(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const data = bodyData(ctx);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return ctx.badRequest('Add at least one item to donate');

    const batchId = crypto.randomUUID();
    const created = [];

    for (const entry of items) {
      const category = cleanString(entry.category, 120);
      const customItemName = cleanString(entry.customItemName, 160);
      const condition = ITEM_CONDITIONS.includes(entry.condition) ? entry.condition : null;
      const quantityTotal = positiveInt(entry.quantity, 1);

      if (!category) continue;
      if (!condition) continue;

      const row = await strapi.entityService.create(ITEM_UID, {
        data: {
          batchId,
          category: category === 'other' ? 'other' : category,
          customItemName: category === 'other' ? customItemName : (customItemName || null),
          condition,
          quantityTotal,
          quantityAvailable: quantityTotal,
          details: cleanString(entry.details, 3000) || null,
          photos: normalizeUrls(entry.photos),
          status: 'available',
          donor: user.id,
        },
      });
      created.push(serializeItem(row));
    }

    if (!created.length) return ctx.badRequest('No valid items to post');

    return { data: { batchId, items: created } };
  },

  async updateItem(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const item = await findItemById(ctx.params.id);
    if (!item) return ctx.notFound('Item not found');
    if (Number(item.donor?.id || item.donor) !== Number(user.id)) {
      return ctx.forbidden('Not your listing');
    }

    const data = bodyData(ctx);
    const update = {};
    const committed = intValue(item.quantityTotal, 0) - intValue(item.quantityAvailable, 0);
    const nextCategory = data.category !== undefined ? cleanString(data.category, 120) : item.category;

    if (data.category !== undefined) {
      if (!nextCategory) return ctx.badRequest('Category is required');
      update.category = nextCategory === 'other' ? 'other' : nextCategory;
    }
    if (data.customItemName !== undefined || data.category !== undefined) {
      const category = update.category || item.category;
      const customItemName = cleanString(data.customItemName ?? item.customItemName, 160);
      update.customItemName = category === 'other' ? customItemName : (customItemName || null);
      if (category === 'other' && !update.customItemName) {
        return ctx.badRequest('Specific item name is required for Other category');
      }
    }
    if (data.condition !== undefined) {
      if (!ITEM_CONDITIONS.includes(data.condition)) return ctx.badRequest('Invalid condition');
      update.condition = data.condition;
    }
    if (data.details !== undefined) {
      update.details = cleanString(data.details, 3000) || null;
    }
    if (data.photos !== undefined) {
      update.photos = normalizeUrls(data.photos);
    }
    if (data.quantityTotal !== undefined) {
      const quantityTotal = positiveInt(data.quantityTotal, 1);
      if (quantityTotal < committed) {
        return ctx.badRequest(`Quantity cannot be less than ${committed} (already allocated to beneficiaries)`);
      }
      const quantityAvailable = quantityTotal - committed;
      update.quantityTotal = quantityTotal;
      update.quantityAvailable = quantityAvailable;
      update.status = computeItemStatus({ ...item, quantityTotal, quantityAvailable });
    }

    if (!Object.keys(update).length) return ctx.badRequest('No valid fields to update');

    const updated = await strapi.entityService.update(ITEM_UID, item.id, { data: update });
    return { data: serializeItem(updated) };
  },

  async deleteItem(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const item = await findItemById(ctx.params.id);
    if (!item) return ctx.notFound('Item not found');
    if (Number(item.donor?.id || item.donor) !== Number(user.id)) {
      return ctx.forbidden('Not your listing');
    }

    const committed = intValue(item.quantityTotal, 0) - intValue(item.quantityAvailable, 0);
    if (committed > 0) {
      return ctx.badRequest('Cannot delete a listing that has already been allocated to beneficiaries');
    }

    const activeApps = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: { item: item.id, status: { $in: ['pending', 'booked'] } },
      limit: 1,
    });
    if (activeApps?.length) {
      return ctx.badRequest('Cannot delete a listing with active requests');
    }

    await strapi.entityService.delete(ITEM_UID, item.id);
    return { data: { id: item.id, deleted: true } };
  },

  async applyForItem(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const item = await findItemById(ctx.params.id);
    if (!item) return ctx.notFound('Item not found');
    if (item.status === 'booked' || item.status === 'completed') return ctx.badRequest('This item is no longer available');
    if (Number(item.donor?.id || item.donor) === Number(user.id)) return ctx.badRequest('You cannot apply for your own donation');

    const data = bodyData(ctx);
    const quantityRequested = positiveInt(data.quantity, 1);
    const message = cleanString(data.message, 2000);
    const photos = normalizeUrls(data.photos).slice(0, 3);

    if (quantityRequested > intValue(item.quantityAvailable, 0)) {
      return ctx.badRequest(`Only ${item.quantityAvailable} available`);
    }
    if (!message) return ctx.badRequest('Message is required');

    const profile = await findProfileByUser(user.id);
    if (!profile?.profilePhotoUrl) {
      return ctx.badRequest('Upload your profile photo on your dashboard before applying');
    }

    const existing = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: {
        item: item.id,
        beneficiary: user.id,
        status: { $in: ['pending', 'approved', 'booked'] },
      },
      limit: 1,
    });
    if (existing?.[0]) return ctx.badRequest('You already have an active application for this item');

    const application = await strapi.entityService.create(APPLICATION_UID, {
      data: {
        item: item.id,
        beneficiary: user.id,
        quantityRequested,
        quantityApproved: 0,
        message,
        photos,
        status: 'pending',
      },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
    });

    await notifyDonorNewRequest(strapi, {
      application,
      item: application.item || item,
      beneficiary: application.beneficiary || user,
      donor: application.item?.donor || item.donor,
    });

    return { data: serializeApplication(application) };
  },

  async myApplications(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: { beneficiary: user.id },
      sort: { createdAt: 'desc' },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
      limit: 200,
    });

    return { data: (rows || []).map((row) => serializeApplication(row)) };
  },

  async myRequests(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const myItems = await strapi.entityService.findMany(ITEM_UID, {
      filters: { donor: user.id },
      fields: ['id'],
      limit: 500,
    });
    const itemIds = (myItems || []).map((row) => row.id);
    if (!itemIds.length) return { data: [] };

    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: { item: { id: { $in: itemIds } }, status: { $in: ['pending', 'booked'] } },
      sort: { createdAt: 'desc' },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
      limit: 200,
    });

    const beneficiaryIds = [...new Set((rows || []).map((row) => row.beneficiary?.id).filter(Boolean))];
    const profiles = beneficiaryIds.length
      ? await strapi.entityService.findMany(PROFILE_UID, {
        filters: { user: { id: { $in: beneficiaryIds } } },
        populate: { user: { fields: ['id'] } },
        limit: beneficiaryIds.length,
      })
      : [];
    const profileByUser = new Map((profiles || []).map((p) => [p.user?.id, serializeProfile(p)]));

    return {
      data: (rows || []).map((row) => ({
        ...serializeApplication(row),
        beneficiaryProfile: profileByUser.get(row.beneficiary?.id) || null,
      })),
    };
  },

  async donationHistory(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: {
        status: 'received',
        item: { donor: user.id },
      },
      sort: { updatedAt: 'desc' },
      populate: {
        item: true,
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
      limit: 200,
    });

    return { data: (rows || []).map((row) => serializeApplication(row)) };
  },

  async listReceivedDonations(ctx) {
    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: { status: 'received' },
      sort: { receivedAt: 'desc' },
      populate: {
        item: {
          populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
        },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
      limit: Math.min(100, positiveInt(ctx.query?.limit, 50)),
    });

    return { data: (rows || []).map((row) => serializeApplication(row)) };
  },

  async reviewApplication(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const applicationId = ctx.params.id;
    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: /^\d+$/.test(applicationId) ? { id: Number(applicationId) } : { documentId: applicationId },
      populate: { item: { populate: { donor: true } }, beneficiary: true },
      limit: 1,
    });
    const application = rows?.[0];
    if (!application) return ctx.notFound('Application not found');

    const item = application.item;
    const donorId = Number(item?.donor?.id || item?.donor);
    if (donorId !== Number(user.id)) return ctx.forbidden('Not your donation item');

    const data = bodyData(ctx);
    const action = cleanString(data.action, 20);

    if (action === 'reject') {
      if (!['pending', 'approved'].includes(application.status)) {
        return ctx.badRequest('Cannot reject this application');
      }
      const updated = await strapi.entityService.update(APPLICATION_UID, application.id, {
        data: { status: 'rejected' },
        populate: { item: true, beneficiary: true },
      });
      return { data: serializeApplication(updated) };
    }

    if (action !== 'approve') return ctx.badRequest('Use approve or reject');

    if (!['pending', 'approved'].includes(application.status)) {
      return ctx.badRequest('Application already processed');
    }

    const approvedQty = positiveInt(data.quantityApproved || application.quantityRequested, application.quantityRequested);
    const pickupLocation = cleanString(data.pickupLocation, 300);
    const pickupPhone = cleanString(data.pickupPhone, 40);
    const available = intValue(item.quantityAvailable, 0);
    const finalQty = Math.min(approvedQty, available, application.quantityRequested);
    if (finalQty < 1) return ctx.badRequest('No quantity available to approve');
    if (!pickupLocation) return ctx.badRequest('Pickup location is required');
    if (!pickupPhone) return ctx.badRequest('Pickup phone number is required');

    const newAvailable = available - finalQty;
    const newItemStatus = computeItemStatus({ quantityAvailable: newAvailable, quantityTotal: item.quantityTotal });

    await strapi.entityService.update(ITEM_UID, item.id, {
      data: {
        quantityAvailable: newAvailable,
        status: newItemStatus,
      },
    });

    const updated = await strapi.entityService.update(APPLICATION_UID, application.id, {
      data: {
        quantityApproved: finalQty,
        pickupLocation,
        pickupPhone,
        status: 'booked',
      },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
    });

    await notifyBeneficiaryRequestApproved(strapi, {
      application: updated,
      item: updated.item || item,
      beneficiary: updated.beneficiary || application.beneficiary,
      donor: user,
      pickupLocation,
      pickupPhone,
    });

    return { data: serializeApplication(updated) };
  },

  async markReceived(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const applicationId = ctx.params.id;
    const rows = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: /^\d+$/.test(applicationId) ? { id: Number(applicationId) } : { documentId: applicationId },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
      limit: 1,
    });
    const application = rows?.[0];
    if (!application) return ctx.notFound('Application not found');
    if (Number(application.beneficiary?.id || application.beneficiary) !== Number(user.id)) {
      return ctx.forbidden('Not your application');
    }
    if (application.status !== 'booked') return ctx.badRequest('Item must be booked before confirming receipt');

    const updated = await strapi.entityService.update(APPLICATION_UID, application.id, {
      data: { status: 'received', receivedAt: new Date().toISOString() },
      populate: {
        item: { populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } } },
        beneficiary: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] },
      },
    });

    const item = updated.item || application.item;
    const donor = item?.donor;
    await notifyDonorItemReceived(strapi, {
      application: updated,
      item,
      beneficiary: user,
      donor,
    });

    const receivedApps = await strapi.entityService.findMany(APPLICATION_UID, {
      filters: { item: item.id, status: 'received' },
      fields: ['quantityApproved'],
      limit: 500,
    });
    const distributed = (receivedApps || []).reduce((sum, row) => sum + intValue(row.quantityApproved, 0), 0);
    if (distributed >= intValue(item.quantityTotal, 0)) {
      await strapi.entityService.update(ITEM_UID, item.id, { data: { status: 'completed' } });
    }

    return { data: serializeApplication(updated) };
  },

  async listFundraisers(ctx) {
    const rows = await strapi.entityService.findMany(FUNDRAISER_UID, {
      filters: { status: { $in: ['active', 'completed'] } },
      sort: { createdAt: 'desc' },
      populate: { creator: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
      limit: Math.min(100, positiveInt(ctx.query?.limit, 50)),
    });

    return { data: (rows || []).map((row) => serializeFundraiser(row, { includeCreator: true })) };
  },

  async findFundraiser(ctx) {
    const fundraiser = await findFundraiserById(ctx.params.id);
    if (!fundraiser) return ctx.notFound('Fundraiser not found');

    const viewer = await authUser(ctx);
    const isCreator = viewer
      && Number(fundraiser.creator?.id || fundraiser.creator) === Number(viewer.id);

    const pledges = await strapi.entityService.findMany(PLEDGE_UID, {
      filters: { fundraiser: fundraiser.id },
      sort: { createdAt: 'desc' },
      populate: { donor: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
      limit: 200,
    });

    const comments = await strapi.entityService.findMany(COMMENT_UID, {
      filters: { fundraiser: fundraiser.id },
      sort: { createdAt: 'desc' },
      populate: { author: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
      limit: 200,
    });

    return {
      data: {
        ...serializeFundraiser(fundraiser, { includeCreator: true }),
        pledges: (pledges || []).map((row) => ({
          id: row.id,
          pledgeType: row.pledgeType || 'items',
          quantity: nonNegativeInt(row.quantity, 0),
          amountUGX: parseAmountUGX(row.amountUGX),
          itemDescription: row.itemDescription || null,
          donorPhone: isCreator ? (row.donorPhone || null) : null,
          createdAt: row.createdAt,
          donor: serializeUser(row.donor),
        })),
        comments: (comments || []).map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.createdAt,
          author: serializeUser(row.author),
        })),
        isCreator,
      },
    };
  },

  async myFundraisers(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const rows = await strapi.entityService.findMany(FUNDRAISER_UID, {
      filters: { creator: user.id },
      sort: { createdAt: 'desc' },
      limit: 100,
    });

    return { data: (rows || []).map((row) => serializeFundraiser(row)) };
  },

  async createFundraiser(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const data = bodyData(ctx);
    const title = cleanString(data.title, 200);
    const description = cleanString(data.description, 5000);
    const goals = parseFundraiserGoals(data);

    if (!title || !description) return ctx.badRequest('Title and description are required');
    if (goals.error) return ctx.badRequest(goals.error);

    const photos = normalizeUrls(data.photos).slice(0, 6);

    const fundraiser = await strapi.entityService.create(FUNDRAISER_UID, {
      data: {
        title,
        slug: slugify(title),
        description,
        fundraiseItems: goals.fundraiseItems,
        fundraiseMoney: goals.fundraiseMoney,
        targetQuantity: goals.targetQuantity,
        targetAmountUGX: goals.targetAmountUGX,
        quantityFulfilled: 0,
        amountFulfilledUGX: 0,
        status: 'active',
        photos,
        creator: user.id,
      },
      populate: { creator: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    });

    return { data: serializeFundraiser(fundraiser, { includeCreator: true }) };
  },

  async updateFundraiser(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'beneficiary') return ctx.forbidden('Beneficiary account required');

    const fundraiser = await findFundraiserById(ctx.params.id);
    if (!fundraiser) return ctx.notFound('Fundraiser not found');
    if (Number(fundraiser.creator?.id || fundraiser.creator) !== Number(user.id)) {
      return ctx.forbidden('Not your fundraiser');
    }
    if (fundraiser.status === 'archived') return ctx.badRequest('Archived fundraisers cannot be edited');

    const data = bodyData(ctx);
    const update = {};

    if (data.title !== undefined) {
      const title = cleanString(data.title, 200);
      if (!title) return ctx.badRequest('Title is required');
      update.title = title;
      update.slug = slugify(title);
    }
    if (data.description !== undefined) {
      const description = cleanString(data.description, 5000);
      if (!description) return ctx.badRequest('Description is required');
      update.description = description;
    }
    const goals = parseFundraiserGoals(data, fundraiser);
    if (goals.error) return ctx.badRequest(goals.error);
    const fulfilledQty = nonNegativeInt(fundraiser.quantityFulfilled, 0);
    const fulfilledAmount = parseAmountUGX(fundraiser.amountFulfilledUGX);
    if (goals.targetQuantity < fulfilledQty) {
      return ctx.badRequest(`Item target must be at least ${fulfilledQty} (already pledged)`);
    }
    if (goals.targetAmountUGX < fulfilledAmount) {
      return ctx.badRequest(`Money target must be at least UGX ${fulfilledAmount.toLocaleString()} (already pledged)`);
    }
    update.fundraiseItems = goals.fundraiseItems;
    update.fundraiseMoney = goals.fundraiseMoney;
    update.targetQuantity = goals.targetQuantity;
    update.targetAmountUGX = goals.targetAmountUGX;
    if (data.photos !== undefined) {
      update.photos = normalizeUrls(data.photos).slice(0, 6);
    }

    if (!Object.keys(update).length) return ctx.badRequest('No valid fields to update');

    const updated = await strapi.entityService.update(FUNDRAISER_UID, fundraiser.id, {
      data: update,
      populate: { creator: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    });
    await syncFundraiserStatus(fundraiser.id);

    return { data: serializeFundraiser(updated, { includeCreator: true }) };
  },

  async pledgeFundraiser(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;
    if (user.foundationRole !== 'donor') return ctx.forbidden('Donor account required');

    const fundraiser = await findFundraiserById(ctx.params.id);
    if (!fundraiser) return ctx.notFound('Fundraiser not found');
    if (fundraiser.status === 'archived') return ctx.badRequest('Fundraiser is archived');

    const progress = fundraiserProgress(fundraiser);
    const data = bodyData(ctx);
    const pledgeType = data.pledgeType === 'money' ? 'money' : 'items';

    if (pledgeType === 'items') {
      if (!progress.canPledgeItems) return ctx.badRequest('This fundraiser is not accepting item pledges right now');
    } else if (!progress.canPledgeMoney) {
      return ctx.badRequest('This fundraiser is not accepting money pledges right now');
    }

    const donorPhone = cleanString(data.donorPhone, 40);
    if (!donorPhone) return ctx.badRequest('Phone number is required to pledge');

    let quantity = 0;
    let amountUGX = 0;
    if (pledgeType === 'items') {
      quantity = positiveInt(data.quantity, 1);
      if (quantity > progress.quantityRemaining) {
        return ctx.badRequest(`Only ${progress.quantityRemaining} item(s) remaining toward the goal`);
      }
    } else {
      amountUGX = positiveInt(parseAmountUGX(data.amountUGX), 1);
      if (amountUGX > progress.amountRemainingUGX) {
        return ctx.badRequest(`Only UGX ${progress.amountRemainingUGX.toLocaleString()} remaining toward the money goal`);
      }
    }

    const pledge = await strapi.entityService.create(PLEDGE_UID, {
      data: {
        fundraiser: fundraiser.id,
        donor: user.id,
        pledgeType,
        quantity,
        amountUGX,
        itemDescription: cleanString(data.itemDescription, 2000) || null,
        donorPhone,
      },
    });

    const fundraiserUpdate = {};
    if (pledgeType === 'items') {
      fundraiserUpdate.quantityFulfilled = progress.quantityFulfilled + quantity;
    } else {
      fundraiserUpdate.amountFulfilledUGX = progress.amountFulfilledUGX + amountUGX;
    }
    await strapi.entityService.update(FUNDRAISER_UID, fundraiser.id, { data: fundraiserUpdate });
    await syncFundraiserStatus(fundraiser.id);

    const refreshed = await strapi.entityService.findOne(FUNDRAISER_UID, fundraiser.id);
    const refreshedProgress = fundraiserProgress(refreshed || fundraiser);
    await notifyBeneficiaryFundraiserPledge(strapi, {
      fundraiser: refreshed || fundraiser,
      pledge,
      donor: user,
      quantity: pledgeType === 'items' ? quantity : 0,
      quantityRemaining: refreshedProgress.quantityRemaining,
    });

    return {
      data: {
        id: pledge.id,
        pledgeType,
        quantity,
        amountUGX,
        itemDescription: pledge.itemDescription || null,
        donorPhone: pledge.donorPhone || null,
        quantityRemaining: refreshedProgress.quantityRemaining,
        amountRemainingUGX: refreshedProgress.amountRemainingUGX,
      },
    };
  },

  async commentFundraiser(ctx) {
    const user = await requireUser(ctx);
    if (!user) return;

    const fundraiser = await findFundraiserById(ctx.params.id);
    if (!fundraiser) return ctx.notFound('Fundraiser not found');

    const data = bodyData(ctx);
    const body = cleanString(data.body, 3000);
    if (!body) return ctx.badRequest('Comment cannot be empty');

    const comment = await strapi.entityService.create(COMMENT_UID, {
      data: {
        fundraiser: fundraiser.id,
        author: user.id,
        body,
      },
      populate: { author: { fields: ['id', 'documentId', 'fullName', 'username', 'email', 'phone', 'foundationRole'] } },
    });

    return {
      data: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: serializeUser(comment.author),
      },
    };
  },

  async impactStats(ctx) {
    const [items, receivedApplications, donorCount, beneficiaryCount] = await Promise.all([
      strapi.entityService.findMany(ITEM_UID, {
        fields: ['quantityTotal'],
        limit: 10000,
      }),
      strapi.entityService.findMany(APPLICATION_UID, {
        filters: { status: 'received' },
        fields: ['quantityApproved', 'quantityRequested'],
        limit: 10000,
      }),
      strapi.db.query('plugin::users-permissions.user').count({
        where: { foundationRole: 'donor' },
      }),
      strapi.db.query('plugin::users-permissions.user').count({
        where: { foundationRole: 'beneficiary' },
      }),
    ]);

    const donatedItems = (items || []).reduce((sum, row) => sum + intValue(row.quantityTotal, 0), 0);
    const itemsReceived = (receivedApplications || []).reduce(
      (sum, row) => sum + intValue(row.quantityApproved || row.quantityRequested, 0),
      0,
    );

    return {
      data: {
        donatedItems,
        beneficiaries: Number(beneficiaryCount || 0),
        donors: Number(donorCount || 0),
        itemsReceived,
      },
    };
  },
};
