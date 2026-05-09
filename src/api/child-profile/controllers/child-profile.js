'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const bcrypt = require('bcryptjs');
const {
  normalizeSavingsGoals,
  buildSavingsSnapshot,
  clampMoney,
  allocateUnallocatedSavings,
  SAVINGS_TRANSACTION_PREFIX,
} = require('../../../utils/savings');
const { submitPayment, getActiveGateway } = require('../../../utils/payment-gateway');

const ALLOWED_FIELDS = ['name', 'dateOfBirth', 'religion', 'avatarUrl', 'dailyWatchMinutes', 'blockedMovieIds', 'allowedMovieIds'];
const MAX_CHILD_PROFILES = 4;
const PIN_PATTERN = /^\d{4}$/;
const RELIGIONS = new Set(['Catholic', 'Protestant', 'Pentecostal', 'Adventist', 'Orthodox', 'Muslim', 'Hindu', 'Bahai', 'Traditional', 'Other']);

function normalizePhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  if (!raw) return '';
  let normalized = raw.replace(/[\s()+-]/g, '');
  if (normalized.startsWith('0')) normalized = `256${normalized.slice(1)}`;
  return normalized;
}

function looksLikePhone(identifier) {
  const normalized = normalizePhone(identifier);
  return /^\d{9,15}$/.test(normalized);
}

function pickAllowed(input = {}) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (out.blockedMovieIds && !Array.isArray(out.blockedMovieIds)) {
    out.blockedMovieIds = [];
  }
  if (out.allowedMovieIds && !Array.isArray(out.allowedMovieIds)) {
    out.allowedMovieIds = [];
  }
  if (out.dailyWatchMinutes != null) {
    const n = Number(out.dailyWatchMinutes);
    out.dailyWatchMinutes = Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : 60;
  }
  if (out.religion != null) {
    const normalizedReligion = String(out.religion || '').trim();
    out.religion = normalizedReligion || null;
    if (out.religion && !RELIGIONS.has(out.religion)) {
      const err = new Error('Invalid child religion');
      err.status = 400;
      throw err;
    }
  }
  return out;
}

function buildPinPayload(input = {}) {
  const rawPin = input.childPin;
  if (rawPin === undefined) {
    return { hasUpdate: false, data: {} };
  }

  const normalizedPin = String(rawPin || '').trim();
  if (!normalizedPin) {
    return { hasUpdate: false, data: {} };
  }

  if (!PIN_PATTERN.test(normalizedPin)) {
    const err = new Error('Child PIN must be exactly 4 digits');
    err.status = 400;
    throw err;
  }

  return {
    hasUpdate: true,
    data: {
      childPinHash: bcrypt.hashSync(normalizedPin, 10),
      childPinUpdatedAt: new Date().toISOString(),
    },
  };
}

function shape(profile) {
  if (!profile) return null;
  const savings = buildSavingsSnapshot(profile);
  return {
    id: profile.id,
    documentId: profile.documentId,
    name: profile.name,
    hasPin: !!profile.childPinHash,
    dateOfBirth: profile.dateOfBirth,
    religion: profile.religion || null,
    avatarUrl: profile.avatarUrl || null,
    dailyWatchMinutes: profile.dailyWatchMinutes ?? 60,
    blockedMovieIds: Array.isArray(profile.blockedMovieIds) ? profile.blockedMovieIds : [],
    allowedMovieIds: Array.isArray(profile.allowedMovieIds) ? profile.allowedMovieIds : [],
    savingsGoals: savings.goals,
    totalSavingsUGX: savings.totalSavingsUGX,
    unallocatedSavingsUGX: savings.unallocatedSavingsUGX,
    savingsLifetimeDepositedUGX: savings.savingsLifetimeDepositedUGX,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function findOwnedProfile(userId, idOrDocId) {
  // Accept numeric id or documentId.
  const where = {
    parent: { id: userId },
  };
  if (/^\d+$/.test(String(idOrDocId))) {
    where.id = Number(idOrDocId);
  } else {
    where.documentId = idOrDocId;
  }
  return strapi.db.query('api::child-profile.child-profile').findOne({ where });
}

async function findParentByIdentifier(identifier) {
  const normalizedIdentifier = String(identifier || '').trim();
  if (!normalizedIdentifier) return null;

  if (looksLikePhone(normalizedIdentifier)) {
    const normalizedPhone = normalizePhone(normalizedIdentifier);
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { provider: 'local', isParent: true, phone: { $notNull: true } },
      select: ['id', 'email', 'username', 'phone'],
      limit: 20000,
    });
    return users.find((entry) => normalizePhone(entry.phone) === normalizedPhone) || null;
  }

  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: {
      provider: 'local',
      isParent: true,
      $or: [{ email: normalizedIdentifier }, { username: normalizedIdentifier }],
    },
    select: ['id', 'email', 'username', 'phone'],
  });
}

async function issueChildLogin(ctx, profile, pin) {
  if (!profile) {
    return ctx.badRequest('Child profile not found');
  }
  if (!profile.childPinHash) {
    return ctx.badRequest('This child profile does not have a PIN set');
  }
  if (!PIN_PATTERN.test(String(pin || ''))) {
    return ctx.badRequest('PIN must be exactly 4 digits');
  }

  const matches = await bcrypt.compare(String(pin), profile.childPinHash);
  if (!matches) {
    return ctx.badRequest('Incorrect PIN');
  }

  const parentId = profile.parent?.id || profile.parent;
  if (!parentId) {
    return ctx.badRequest('Parent account not found');
  }

  const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: parentId });
  ctx.body = {
    data: {
      jwt,
      childProfile: shape(profile),
    },
  };
  return undefined;
}

module.exports = createCoreController('api::child-profile.child-profile', ({ strapi }) => ({
  // GET /child-profiles/mine — list profiles for the current user.
  async mine(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    strapi.log.info(`[mine] Fetching profiles for user.id=${user.id}`);
    
    // In Strapi v5, use the document service (documents().findMany) which properly
    // selects and serializes JSON columns for collection types. The db.query path
    // strips custom JSON columns without explicit mapping.
    const list = await strapi.documents('api::child-profile.child-profile').findMany({
      filters: { parent: { id: user.id } },
      sort: 'createdAt:asc',
      populate: '*',
    });
    
    strapi.log.info(`[mine] Found ${list.length} profiles. First profile goals count: ${Array.isArray(list[0]?.savingsGoals) ? list[0].savingsGoals.length : typeof list[0]?.savingsGoals}`);

    ctx.body = { data: list.map(shape) };
  },

  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    if (!user.isParent) {
      return ctx.forbidden('Only parent accounts can create child profiles.');
    }

    const existingCount = await strapi.db.query('api::child-profile.child-profile').count({
      where: { parent: { id: user.id } },
    });

    if (existingCount >= MAX_CHILD_PROFILES) {
      return ctx.badRequest(`You can only create up to ${MAX_CHILD_PROFILES} child profiles.`);
    }

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    let data;
    try {
      data = pickAllowed(body);
    } catch (err) {
      return ctx.badRequest(err.message || 'Invalid child profile data');
    }
    if (!data.name || !data.dateOfBirth) {
      return ctx.badRequest('name and dateOfBirth are required');
    }
    if (!Array.isArray(data.blockedMovieIds)) data.blockedMovieIds = [];
    if (!Array.isArray(data.allowedMovieIds)) data.allowedMovieIds = [];

    let pinPayload;
    try {
      pinPayload = buildPinPayload(body);
    } catch (err) {
      return ctx.badRequest(err.message || 'Invalid child PIN');
    }

    // Use entityService so JSON fields (blockedMovieIds) are serialized
    // correctly for SQLite — db.query passes arrays straight to knex which
    // cannot bind them.
    const created = await strapi.entityService.create('api::child-profile.child-profile', {
      data: { ...data, ...pinPayload.data, parent: user.id },
    });

    ctx.body = { data: shape(created) };
  },

  async update(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    let data;
    try {
      data = pickAllowed(body);
    } catch (err) {
      return ctx.badRequest(err.message || 'Invalid child profile data');
    }
    let pinPayload;
    try {
      pinPayload = buildPinPayload(body);
    } catch (err) {
      return ctx.badRequest(err.message || 'Invalid child PIN');
    }

    const updated = await strapi.entityService.update('api::child-profile.child-profile', profile.id, {
      data: { ...data, ...pinPayload.data },
    });

    ctx.body = { data: shape(updated) };
  },

  async delete(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    await strapi.db.query('api::child-profile.child-profile').delete({
      where: { id: profile.id },
    });

    ctx.body = { data: { id: profile.id, deleted: true } };
  },

  // PATCH /child-profiles/:id/blocks — add/remove a single movieId block.
  async toggleBlock(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    const body = ctx.request.body || {};
    const movieId = String(body.movieId || '').trim();
    const action = body.action === 'unblock' ? 'unblock' : 'block';
    if (!movieId) return ctx.badRequest('movieId required');

    const current = Array.isArray(profile.blockedMovieIds) ? profile.blockedMovieIds.map(String) : [];
    let next;
    if (action === 'block') {
      next = current.includes(movieId) ? current : [...current, movieId];
    } else {
      next = current.filter((id) => id !== movieId);
    }

    const updated = await strapi.entityService.update('api::child-profile.child-profile', profile.id, {
      data: { blockedMovieIds: next },
    });

    ctx.body = { data: shape(updated) };
  },

  // PATCH /child-profiles/:id/allowed — add/remove a single movieId from the
  // child's curated allow-list. Action: "allow" | "disallow".
  async toggleAllowed(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    const body = ctx.request.body || {};
    const movieId = String(body.movieId || '').trim();
    const action = body.action === 'disallow' ? 'disallow' : 'allow';
    if (!movieId) return ctx.badRequest('movieId required');

    const current = Array.isArray(profile.allowedMovieIds) ? profile.allowedMovieIds.map(String) : [];
    let next;
    if (action === 'allow') {
      next = current.includes(movieId) ? current : [...current, movieId];
    } else {
      next = current.filter((id) => id !== movieId);
    }

    const updated = await strapi.entityService.update('api::child-profile.child-profile', profile.id, {
      data: { allowedMovieIds: next },
    });

    ctx.body = { data: shape(updated) };
  },

  async verifyPin(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();
    if (!profile.childPinHash) {
      return ctx.badRequest('This child profile does not have a PIN set');
    }

    const { pin } = ctx.request.body || {};
    if (!PIN_PATTERN.test(String(pin || ''))) {
      return ctx.badRequest('PIN must be exactly 4 digits');
    }

    const verified = await bcrypt.compare(String(pin), profile.childPinHash);
    if (!verified) {
      return ctx.badRequest('Incorrect PIN');
    }

    ctx.body = { data: { verified: true, id: profile.documentId || profile.id } };
  },

  async updateSavingsGoals(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};

    let goals;
    try {
      goals = normalizeSavingsGoals(body.goals);
    } catch (err) {
      return ctx.badRequest(err.message || 'Invalid savings goals');
    }

    const nextSavings = allocateUnallocatedSavings(profile, goals);
    const updated = await strapi.documents('api::child-profile.child-profile').update({
      documentId: profile.documentId,
      data: nextSavings,
      populate: '*',
    });

    ctx.body = { data: shape(updated) };
  },

  /**
   * POST /child-profiles/:id/savings-deposit-initiate
   * Initiates a real mobile-money payment for a parent to deposit money
   * into a child's piggy bank. The amount is only credited once payment
   * confirmation is received via the gateway IPN/webhook (or polled status).
   *
   * Mirrors the flow used by /purchases for movies — creating a pending
   * purchase row with a SAV_ transactionId so the existing webhook handlers
   * (pesapal-webhook, dgateway-webhook, yo-webhook) and the purchase
   * lifecycle apply the deposit on completion.
   */
  async initiateSavingsDeposit(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const profile = await findOwnedProfile(user.id, ctx.params.id);
    if (!profile) return ctx.notFound();

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    const amount = clampMoney(body.amountUGX);
    if (amount <= 0) {
      return ctx.badRequest('Deposit amount must be greater than zero');
    }

    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const activeGateway = await getActiveGateway(strapi);
    const ipnId = settings?.pesapalIpnId;

    if (activeGateway === 'pesapal' && !ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }

    const paymentPhone = String(body.paymentPhone || '').trim();
    if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !paymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
    }

    const merchantReference = `${SAVINGS_TRANSACTION_PREFIX}${user.id}_${profile.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const frontendUrl = process.env.FRONTEND_URL;
    const callbackUrl = `${frontendUrl}/payment/callback`;
    const description = `Piggy bank deposit for ${profile.name}`;

    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: {
        movie: null,
        providerMaterial: null,
        buyer: user.id,
        childProfile: profile.id,
        amount,
        paymentMethod: body.paymentMethod || activeGateway,
        paymentPhone: paymentPhone || '',
        transactionId: merchantReference,
        status: 'pending',
        savingsDepositApplied: false,
      },
    });

    try {
      const nameParts = (user.fullName || user.username || '').split(' ');
      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount,
        description: `Mr.Flix - ${description}`,
        callbackUrl,
        ipnId,
        paymentPhone: paymentPhone || '',
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      const updateData = {};
      if (paymentResult.gateway === 'pesapal') {
        updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      } else if (paymentResult.gateway === 'dgateway') {
        updateData.dgatewayReference = paymentResult.reference;
      } else if (paymentResult.gateway === 'yo') {
        updateData.yoReference = paymentResult.reference;
      }

      if (Object.keys(updateData).length > 0) {
        await strapi.documents('api::purchase.purchase').update({
          documentId: purchase.documentId,
          data: updateData,
        });
      }

      ctx.body = {
        data: {
          purchaseId: purchase.documentId,
          transactionId: merchantReference,
          gateway: paymentResult.gateway,
          amountUGX: amount,
          childProfileId: profile.id,
          redirect_url: paymentResult.redirect_url || null,
          order_tracking_id: paymentResult.order_tracking_id || null,
          reference: paymentResult.reference || null,
          paymentStatus: paymentResult.status || null,
        },
      };
      return undefined;
    } catch (err) {
      strapi.log.error('Savings deposit payment initiation failed:', err);
      await strapi.documents('api::purchase.purchase').update({
        documentId: purchase.documentId,
        data: { status: 'failed' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  async login(ctx) {
    const { childProfileId, identifier, pin } = ctx.request.body || {};

    if (childProfileId != null && String(childProfileId).trim() !== '') {
      const rawId = String(childProfileId).trim();
      const where = /^\d+$/.test(rawId) ? { id: Number(rawId) } : { documentId: rawId };
      const profile = await strapi.db.query('api::child-profile.child-profile').findOne({
        where,
        populate: { parent: { select: ['id'] } },
      });
      return issueChildLogin(ctx, profile, pin);
    }

    if (!String(identifier || '').trim()) {
      return ctx.badRequest('Parent phone number is required');
    }
    const parent = await findParentByIdentifier(identifier);
    if (!parent) {
      return ctx.badRequest('Parent account not found');
    }

    const profiles = await strapi.db.query('api::child-profile.child-profile').findMany({
      where: { parent: { id: parent.id } },
      orderBy: { createdAt: 'asc' },
    });

    const matches = [];
    for (const profile of profiles) {
      if (!profile?.childPinHash) continue;
      const verified = await bcrypt.compare(String(pin || ''), profile.childPinHash);
      if (verified) {
        profile.parent = parent.id;
        matches.push(profile);
      }
    }

    if (matches.length === 0) {
      return ctx.badRequest('Incorrect PIN');
    }
    if (matches.length > 1) {
      return ctx.badRequest('Multiple child profiles use this PIN. Please set a different PIN for each child.');
    }

    return issueChildLogin(ctx, matches[0], pin);
  },
}));
