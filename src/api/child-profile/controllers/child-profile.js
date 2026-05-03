'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const bcrypt = require('bcryptjs');

const ALLOWED_FIELDS = ['name', 'dateOfBirth', 'avatarUrl', 'dailyWatchMinutes', 'blockedMovieIds', 'allowedMovieIds'];
const MAX_CHILD_PROFILES = 4;
const PIN_PATTERN = /^\d{4}$/;

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
  return {
    id: profile.id,
    documentId: profile.documentId,
    name: profile.name,
    hasPin: !!profile.childPinHash,
    dateOfBirth: profile.dateOfBirth,
    avatarUrl: profile.avatarUrl || null,
    dailyWatchMinutes: profile.dailyWatchMinutes ?? 60,
    blockedMovieIds: Array.isArray(profile.blockedMovieIds) ? profile.blockedMovieIds : [],
    allowedMovieIds: Array.isArray(profile.allowedMovieIds) ? profile.allowedMovieIds : [],
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

    const list = await strapi.db.query('api::child-profile.child-profile').findMany({
      where: { parent: { id: user.id } },
      orderBy: { createdAt: 'asc' },
    });

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
    const data = pickAllowed(body);
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
    const data = pickAllowed(body);
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
