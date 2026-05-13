'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function withSellerPaymentFallback(product) {
  if (!product) return product;

  return {
    ...product,
    paymentPhone: product.paymentPhone || product.seller?.paymentPhone || null,
    paymentCode: product.paymentCode || product.seller?.paymentCode || null,
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

    return { data: products };
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
        stockQuantity: input.stockQuantity,
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

    return { data: created };
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

    return { data: products.map(withSellerPaymentFallback) };
  },

  async findOne(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);

    if (!product) {
      return ctx.notFound('Product not found');
    }

    if (!ctx.state.user && product.status !== 'active') {
      return ctx.notFound('Product not found');
    }

    return { data: withSellerPaymentFallback(product) };
  },
}));
