'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { findByIdOrDocumentId } = require('../../../utils/cars');

const UID = 'api::car-save.car-save';
const PRODUCT_UID = 'api::product.product';
const USER_UID = 'plugin::users-permissions.user';

function trim(value) {
  return String(value ?? '').trim();
}

function normalizeUgPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('256')) return digits;
  return digits ? `256${digits}` : '';
}

function productId(product) {
  return product?.documentId || product?.id;
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async toggle(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const product = await findByIdOrDocumentId(strapi, PRODUCT_UID, ctx.params.id);
    if (!product) return ctx.notFound('Car not found');

    const existing = await strapi.entityService.findMany(UID, {
      filters: { user: { id: user.id }, product: { id: product.id } },
      limit: 1,
    });

    if (existing?.[0]) {
      await strapi.entityService.delete(UID, existing[0].id);
      return { data: { saved: false, productId: productId(product) } };
    }

    await strapi.entityService.create(UID, {
      data: { user: user.id, product: product.id },
    });
    return { data: { saved: true, productId: productId(product) } };
  },

  async mine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const rows = await strapi.entityService.findMany(UID, {
      filters: { user: { id: user.id } },
      populate: { product: { fields: ['id', 'documentId', 'name', 'status'] } },
      sort: { createdAt: 'desc' },
      limit: 500,
    });

    return {
      data: (rows || [])
        .map((row) => productId(row.product))
        .filter(Boolean)
        .map(String),
    };
  },

  async updateProfile(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const firstName = trim(body.firstName);
    const lastName = trim(body.lastName);
    const fullName = trim(body.fullName) || [firstName, lastName].filter(Boolean).join(' ');
    const email = trim(body.email).toLowerCase();
    const phone = normalizeUgPhone(body.phone);
    const country = trim(body.country);
    const location = trim(body.location);
    const whatsappNumber = trim(body.whatsappNumber);

    const data = {};
    if (fullName) data.fullName = fullName;
    if (email && !email.endsWith('@phone.movokids.local')) data.email = email;
    if (phone) data.phone = phone;
    if (country) data.country = country;
    if (Object.prototype.hasOwnProperty.call(body, 'location')) data.location = location;
    if (Object.prototype.hasOwnProperty.call(body, 'whatsappNumber')) data.whatsappNumber = whatsappNumber;

    if (!Object.keys(data).length) return ctx.badRequest('No profile fields to update');

    const updated = await strapi.db.query(USER_UID).update({
      where: { id: user.id },
      data,
    });
    return {
      data: {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        country: updated.country,
        location: updated.location,
        whatsappNumber: updated.whatsappNumber,
      },
    };
  },
}));
