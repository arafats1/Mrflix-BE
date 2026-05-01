'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const ALLOWED_FIELDS = ['name', 'dateOfBirth', 'avatarUrl', 'dailyWatchMinutes', 'blockedMovieIds'];

function pickAllowed(input = {}) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (out.blockedMovieIds && !Array.isArray(out.blockedMovieIds)) {
    out.blockedMovieIds = [];
  }
  if (out.dailyWatchMinutes != null) {
    const n = Number(out.dailyWatchMinutes);
    out.dailyWatchMinutes = Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : 60;
  }
  return out;
}

function shape(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    documentId: profile.documentId,
    name: profile.name,
    dateOfBirth: profile.dateOfBirth,
    avatarUrl: profile.avatarUrl || null,
    dailyWatchMinutes: profile.dailyWatchMinutes ?? 60,
    blockedMovieIds: Array.isArray(profile.blockedMovieIds) ? profile.blockedMovieIds : [],
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

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    const data = pickAllowed(body);
    if (!data.name || !data.dateOfBirth) {
      return ctx.badRequest('name and dateOfBirth are required');
    }
    if (!Array.isArray(data.blockedMovieIds)) data.blockedMovieIds = [];

    // Use entityService so JSON fields (blockedMovieIds) are serialized
    // correctly for SQLite — db.query passes arrays straight to knex which
    // cannot bind them.
    const created = await strapi.entityService.create('api::child-profile.child-profile', {
      data: { ...data, parent: user.id },
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

    const updated = await strapi.entityService.update('api::child-profile.child-profile', profile.id, {
      data,
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
}));
