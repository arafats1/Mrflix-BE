'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { evaluatePromoCode, normalizeCode } = require('../../../utils/promo-code');

const UID = 'api::promo-code.promo-code';

function isAdminRole(user) {
  if (!user) return false;
  const t = user.role?.type || user.role?.name;
  return t === 'admin' || t === 'Admin';
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    if (!isAdminRole(ctx.state.user)) return ctx.forbidden('Admin only');

    const entries = await strapi.entityService.findMany(UID, {
      sort: { createdAt: 'desc' },
      limit: 500,
    });
    return { data: entries };
  },

  async findOne(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    if (!isAdminRole(ctx.state.user)) return ctx.forbidden('Admin only');

    const id = ctx.params.id;
    const entry = await strapi.entityService.findOne(UID, id);
    if (!entry) return ctx.notFound('Promo code not found');
    return { data: entry };
  },

  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    if (!isAdminRole(ctx.state.user)) return ctx.forbidden('Admin only');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const code = normalizeCode(body.code);
    if (!code) return ctx.badRequest('code is required');
    const discountPercent = parseInt(body.discountPercent, 10);
    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      return ctx.badRequest('discountPercent must be between 1 and 100');
    }

    // Reject duplicates upfront with a friendly message
    const existing = await strapi.entityService.findMany(UID, {
      filters: { code },
      limit: 1,
    });
    if (existing && existing.length) {
      return ctx.badRequest('A promo code with that name already exists');
    }

    const data = {
      code,
      discountPercent,
      validFrom: body.validFrom || null,
      validUntil: body.validUntil || null,
      maxUses: parseInt(body.maxUses, 10) || 0,
      usedCount: 0,
      isActive: body.isActive === false ? false : true,
      description: (body.description || '').toString().slice(0, 250),
    };

    const entry = await strapi.entityService.create(UID, { data });
    return { data: entry };
  },

  async update(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    if (!isAdminRole(ctx.state.user)) return ctx.forbidden('Admin only');

    const id = ctx.params.id;
    const body = ctx.request.body?.data || ctx.request.body || {};
    const data = {};

    if (body.code !== undefined) {
      const newCode = normalizeCode(body.code);
      if (!newCode) return ctx.badRequest('code cannot be empty');
      // Uniqueness guard against other rows
      const dup = await strapi.entityService.findMany(UID, {
        filters: { code: newCode },
        limit: 2,
      });
      if (dup && dup.find((d) => String(d.id) !== String(id))) {
        return ctx.badRequest('Another promo code already uses that name');
      }
      data.code = newCode;
    }
    if (body.discountPercent !== undefined) {
      const p = parseInt(body.discountPercent, 10);
      if (!Number.isFinite(p) || p < 1 || p > 100) {
        return ctx.badRequest('discountPercent must be between 1 and 100');
      }
      data.discountPercent = p;
    }
    if (body.validFrom !== undefined) data.validFrom = body.validFrom || null;
    if (body.validUntil !== undefined) data.validUntil = body.validUntil || null;
    if (body.maxUses !== undefined) data.maxUses = parseInt(body.maxUses, 10) || 0;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (body.description !== undefined) data.description = (body.description || '').toString().slice(0, 250);

    const entry = await strapi.entityService.update(UID, id, { data });
    return { data: entry };
  },

  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    if (!isAdminRole(ctx.state.user)) return ctx.forbidden('Admin only');

    const id = ctx.params.id;
    await strapi.entityService.delete(UID, id);
    return { data: { id } };
  },

  // Authenticated viewers call this from the subscription page to preview
  // the discount before submitting the payment.
  async validate(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('Login required');
    const body = ctx.request.body?.data || ctx.request.body || {};
    const result = await evaluatePromoCode(strapi, body.code);
    if (!result.ok) {
      return { data: { valid: false, reason: result.reason } };
    }
    const r = result.record;
    return {
      data: {
        valid: true,
        code: r.code,
        discountPercent: r.discountPercent,
        description: r.description || '',
        validUntil: r.validUntil || null,
      },
    };
  },
}));

// Expose the helper for legacy imports; new callers should use ../../../utils/promo-code.
module.exports.evaluatePromoCode = evaluatePromoCode;
