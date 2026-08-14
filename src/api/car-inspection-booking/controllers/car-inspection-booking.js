'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const { findByIdOrDocumentId } = require('../../../utils/cars');

const STATUSES = new Set(['new', 'confirmed', 'in_progress', 'completed', 'cancelled']);
const UID = 'api::car-inspection-booking.car-inspection-booking';

function trim(value) {
  return String(value ?? '').trim();
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const user = await resolveAuthUser(strapi, ctx);

    const name = trim(body.name);
    const phone = trim(body.phone);
    const email = trim(body.email).toLowerCase();
    const make = trim(body.make);
    const model = trim(body.model);
    const year = trim(body.year);
    const address = trim(body.address);
    const district = trim(body.district);
    const city = trim(body.city);
    const preferredDate = trim(body.preferredDate || body.date);
    const preferredTime = trim(body.preferredTime || body.time);

    if (!name || !phone || !email || !make || !model || !year || !address || !preferredDate || !preferredTime) {
      return ctx.badRequest('Missing required inspection booking fields');
    }

    const entry = await strapi.entityService.create(UID, {
      data: {
        status: 'new',
        name,
        phone,
        email,
        make,
        model,
        year,
        address,
        district: district || null,
        city: city || null,
        preferredDate,
        preferredTime,
        ...(user?.id ? { user: user.id } : {}),
      },
    });

    return {
      data: {
        id: entry.id,
        documentId: entry.documentId,
        message: 'Your inspection has been booked.',
      },
    };
  },

  async mine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const entries = await strapi.entityService.findMany(UID, {
      filters: {
        $or: [
          { user: { id: user.id } },
          { email: user.email },
        ],
      },
      sort: { createdAt: 'desc' },
    });

    return { data: entries };
  },

  async updateStatus(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const existing = await findByIdOrDocumentId(strapi, UID, ctx.params.id);
    if (!existing) return ctx.notFound('Inspection booking not found');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const status = trim(body.status);
    if (status && !STATUSES.has(status)) {
      return ctx.badRequest('Invalid inspection status');
    }

    const updated = await strapi.entityService.update(UID, existing.id, {
      data: {
        ...(status ? { status } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'adminNotes') ? { adminNotes: trim(body.adminNotes) || null } : {}),
      },
    });

    return { data: updated };
  },
}));
