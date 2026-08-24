'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const { findByIdOrDocumentId } = require('../../../utils/cars');

const STATUSES = new Set(['new', 'verifying', 'verified', 'contacted', 'available', 'sold', 'rejected', 'cancelled']);
const ACTIVE_STATUSES = ['new', 'verifying', 'verified', 'contacted'];
const UID = 'api::car-reservation-booking.car-reservation-booking';
const PRODUCT_UID = 'api::product.product';

function trim(value) {
  return String(value ?? '').trim();
}

async function resolveProductIds(strapi, productId) {
  const ids = new Set([String(productId)]);
  const product = await findByIdOrDocumentId(strapi, PRODUCT_UID, productId).catch(() => null);
  if (product?.documentId) ids.add(String(product.documentId));
  if (product?.id) ids.add(String(product.id));
  return { ids: [...ids].filter(Boolean), product };
}

async function findActiveBooking(strapi, productIds) {
  const rows = await strapi.entityService.findMany(UID, {
    filters: {
      productId: { $in: productIds },
      status: { $in: ACTIVE_STATUSES },
    },
    limit: 1,
  });
  return rows?.[0] || null;
}

async function syncListingForReservationStatus(strapi, reservation, status) {
  const productId = trim(reservation?.productId);
  if (!productId || !status) return null;

  const product = await findByIdOrDocumentId(strapi, PRODUCT_UID, productId).catch(() => null);
  if (!product) return null;

  if (status === 'sold' && product.status !== 'discontinued') {
    return strapi.entityService.update(PRODUCT_UID, product.id, {
      data: { status: 'discontinued' },
    });
  }

  if (status === 'available' && product.status !== 'active') {
    return strapi.entityService.update(PRODUCT_UID, product.id, {
      data: { status: 'active' },
    });
  }

  return product;
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const user = await resolveAuthUser(strapi, ctx);

    const fullName = trim(body.fullName || body.name);
    const phone = trim(body.phone);
    const address = trim(body.address);
    const productId = trim(body.productId);
    const productName = trim(body.productName);
    const dealerSlug = trim(body.dealerSlug);
    const dealerName = trim(body.dealerName);
    const proofUrl = trim(body.proofUrl);
    const proofFileName = trim(body.proofFileName);
    const bookingFeeUGX = Number(body.bookingFeeUGX || 1000000);

    if (!fullName || !phone || !address || !productId || !productName || !proofUrl) {
      return ctx.badRequest('Missing required booking fields');
    }

    const { ids: productIds, product } = await resolveProductIds(strapi, productId);
    const existing = await findActiveBooking(strapi, productIds);
    if (existing) {
      return ctx.badRequest('This car is already booked');
    }

    const canonicalProductId = String(product?.documentId || product?.id || productId);

    const entry = await strapi.entityService.create(UID, {
      data: {
        status: 'new',
        fullName,
        phone,
        address,
        productId: canonicalProductId,
        productName,
        dealerSlug: dealerSlug || null,
        dealerName: dealerName || null,
        bookingFeeUGX: Number.isFinite(bookingFeeUGX) ? bookingFeeUGX : 1000000,
        proofUrl,
        proofFileName: proofFileName || null,
        ...(user?.id ? { user: user.id } : {}),
      },
    });

    return {
      data: {
        id: entry.documentId || entry.id,
        documentId: entry.documentId,
        status: entry.status,
        message: 'Booking submitted. Our team will verify your payment and reach out soon.',
      },
    };
  },

  async updateStatus(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const existing = await findByIdOrDocumentId(strapi, UID, ctx.params.id);
    if (!existing) return ctx.notFound('Reservation booking not found');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const status = trim(body.status);
    if (status && !STATUSES.has(status)) {
      return ctx.badRequest('Invalid reservation status');
    }

    const updated = await strapi.entityService.update(UID, existing.id, {
      data: {
        ...(status ? { status } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'adminNotes')
          ? { adminNotes: trim(body.adminNotes) || null }
          : {}),
      },
    });

    if (status === 'available' || status === 'sold') {
      await syncListingForReservationStatus(strapi, existing, status);
    }

    return { data: updated };
  },

  async bookedProductIds(ctx) {
    const rows = await strapi.entityService.findMany(UID, {
      filters: { status: { $in: ACTIVE_STATUSES } },
      fields: ['productId'],
      limit: 1000,
    });

    const productIds = new Set();
    for (const row of rows || []) {
      const storedId = trim(row.productId);
      if (!storedId) continue;
      productIds.add(storedId);
      const { ids } = await resolveProductIds(strapi, storedId);
      ids.forEach((id) => productIds.add(id));
    }

    return { data: { productIds: [...productIds] } };
  },
}));
