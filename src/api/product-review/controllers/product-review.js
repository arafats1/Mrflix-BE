'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

function clampRating(value) {
  const rating = Number.parseInt(value, 10);
  if (Number.isNaN(rating)) return 5;
  return Math.min(5, Math.max(1, rating));
}

module.exports = createCoreController('api::product-review.product-review', ({ strapi }) => ({
  async find(ctx) {
    const productId = String(ctx.query.productId || '').trim();
    if (!productId) {
      return ctx.badRequest('productId is required');
    }

    const reviews = await strapi.documents('api::product-review.product-review').findMany({
      filters: {
        productId,
        status: 'approved',
      },
      sort: { createdAt: 'desc' },
    });

    return { data: reviews };
  },

  async create(ctx) {
    const input = ctx.request.body?.data || ctx.request.body || {};
    const productId = String(input.productId || '').trim();
    const reviewerName = String(input.reviewerName || '').trim().slice(0, 80);
    const comment = String(input.comment || '').trim().slice(0, 1200);

    if (!productId || !reviewerName || !comment) {
      return ctx.badRequest('Product, name and review are required');
    }

    const review = await strapi.documents('api::product-review.product-review').create({
      data: {
        productId,
        reviewerName,
        rating: clampRating(input.rating),
        comment,
        status: 'approved',
      },
    });

    return { data: review };
  },
}));