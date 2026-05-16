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
    marketplaceSource: product.marketplaceSource || 'core',
  };
}

function normalizeMarketplaceSource(value) {
  return value === 'entrepreneur' ? 'entrepreneur' : 'core';
}

async function getEntrepreneurProfileForUser(strapi, userId) {
  if (!userId) return null;

  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
  });

  return profiles?.[0] || null;
}

async function enrichSellerIdentity(strapi, product) {
  if (!product?.seller?.id) return product;

  const entrepreneurProfile = await getEntrepreneurProfileForUser(strapi, product.seller.id);
  const sellerDisplayName = entrepreneurProfile?.fullName || product.seller?.fullName || product.seller?.shopName || product.seller?.username || product.seller?.email || null;
  const sellerLocation = entrepreneurProfile?.location || product.seller?.location || null;
  const sellerPhone = entrepreneurProfile?.phone || product.paymentPhone || product.seller?.phone || product.seller?.paymentPhone || null;

  return {
    ...product,
    sellerDisplayName,
    sellerLocation,
    sellerPhone,
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
    ...(await enrichSellerIdentity(strapi, withSellerPaymentFallback(product))),
    soldCount,
  };
}

async function attachReviewSummary(strapi, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : [products].filter(Boolean);
  if (!list.length) return Array.isArray(products) ? [] : null;

  const productIds = [...new Set(list.map((product) => String(product.documentId || product.id || '')).filter(Boolean))];
  if (!productIds.length) return Array.isArray(products) ? list : list[0];

  const reviews = await strapi.documents('api::product-review.product-review').findMany({
    filters: {
      productId: { $in: productIds },
      status: 'approved',
    },
    status: 'published',
  }).catch(() => []);

  const summaryByProductId = reviews.reduce((acc, review) => {
    const key = String(review.productId || '').trim();
    if (!key) return acc;
    acc[key] = acc[key] || { total: 0, count: 0 };
    acc[key].total += Number(review.rating || 0);
    acc[key].count += 1;
    return acc;
  }, {});

  const enriched = list.map((product) => {
    const key = String(product.documentId || product.id || '').trim();
    const summary = summaryByProductId[key] || { total: 0, count: 0 };
    const average = summary.count > 0 ? Math.round((summary.total / summary.count) * 10) / 10 : 0;

    return {
      ...product,
      rating: average,
      reviewsCount: summary.count,
    };
  });

  return Array.isArray(products) ? enriched : enriched[0];
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

    const soldProducts = await Promise.all(products.map((product) => withSoldCount(strapi, product)));
    return { data: await attachReviewSummary(strapi, soldProducts) };
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
        marketplaceSource: normalizeMarketplaceSource(input.marketplaceSource),
        status: input.status || 'active',
        seller: ctx.state.user.id,
      },
      populate: {
        seller: true,
      },
      status: 'published',
    });

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, created)) };
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

    const soldProducts = await Promise.all(products.map((product) => withSoldCount(strapi, product)));
    return { data: await attachReviewSummary(strapi, soldProducts) };
  },

  async findOne(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);

    if (!product) {
      return ctx.notFound('Product not found');
    }

    if (!ctx.state.user && product.status !== 'active') {
      return ctx.notFound('Product not found');
    }

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, product)) };
  },
}));
