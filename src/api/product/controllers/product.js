'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function normalizeDeliveryAreas(input = []) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,]+/)
      : [];

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function withSellerPaymentFallback(product) {
  if (!product) return product;

  return {
    ...product,
    deliveryAreas: normalizeDeliveryAreas(product.deliveryAreas),
    paymentPhone: product.paymentPhone || product.seller?.paymentPhone || null,
    paymentCode: product.paymentCode || product.seller?.paymentCode || null,
  };
}

async function withSoldCount(strapi, product) {
  if (!product) return product;

  const soldCount = await strapi.db.query('api::purchase.purchase').count({
    where: {
      product: { id: product.id },
      status: { $ne: 'failed' },
    },
  });

  return {
    ...withSellerPaymentFallback(product),
    soldCount,
  };
}

function sanitizeProductIdentifier(value) {
  return decodeURIComponent(String(value || '')).trim().split(/\s+/)[0] || '';
}

async function findProductByIdentifier(strapi, id) {
  const normalizedId = sanitizeProductIdentifier(id);

  if (!normalizedId) return null;

  if (/^\d+$/.test(normalizedId)) {
    return strapi.entityService.findOne('api::product.product', normalizedId, {
      populate: {
        seller: true,
      },
    });
  }

  const products = await strapi.documents('api::product.product').findMany({
    filters: {
      documentId: normalizedId,
    },
    populate: {
      seller: true,
    },
    limit: 1,
    status: 'published',
  });

  return products?.[0] || null;
}

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
  /**
   * Get products owned by the current user.
   */
  async mine(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in to view your products');
    }

    const products = await strapi.documents('api::product.product').findMany({
      filters: {
        seller: { id: ctx.state.user.id },
      },
      populate: {
        seller: true,
      },
      sort: { createdAt: 'desc' },
      status: 'published',
    });

    return { data: await Promise.all(products.map((product) => withSoldCount(strapi, product))) };
  },

  /**
   * Create a product and link it to the current user (the seller).
   */
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in to create a product');
    }

    const input = ctx.request.body?.data || {};
    const created = await strapi.documents('api::product.product').create({
      data: {
        name: input.name,
        description: input.description,
        priceUGX: input.priceUGX,
        category: input.category,
        images: Array.isArray(input.images) ? input.images : [],
        featuredImage: input.featuredImage,
        ageRange: input.ageRange,
        audience: input.audience || 'children',
        discountPercent: input.discountPercent,
        stockQuantity: input.stockQuantity,
        deliveryAreas: normalizeDeliveryAreas(input.deliveryAreas),
        paymentPhone: input.paymentPhone,
        paymentCode: input.paymentCode,
        status: input.status || 'active',
        seller: ctx.state.user.id,
      },
      populate: {
        seller: true,
      },
      status: 'published',
    });

    return { data: await withSoldCount(strapi, created) };
  },

  /**
   * Only return 'active' products by default for public users.
   */
  async find(ctx) {
    const filters = {
      ...(ctx.query.filters || {}),
    };

    if (!ctx.state.user) {
      filters.status = 'active';
    }

    const products = await strapi.documents('api::product.product').findMany({
      filters,
      populate: {
        seller: true,
      },
      sort: ctx.query.sort || { createdAt: 'desc' },
      status: 'published',
    });

    return { data: await Promise.all(products.map((product) => withSoldCount(strapi, product))) };
  },

  async findOne(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);

    if (!product) {
      return ctx.notFound('Product not found');
    }

    if (!ctx.state.user && product.status !== 'active') {
      return ctx.notFound('Product not found');
    }

    return { data: await withSoldCount(strapi, product) };
  },
}));
