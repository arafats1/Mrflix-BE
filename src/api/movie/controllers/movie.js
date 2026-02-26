'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::movie.movie', ({ strapi }) => ({
  // Override find to add custom filtering
  async find(ctx) {
    // Allow filtering by type, featured, available
    const { type, featured, available, q } = ctx.query;

    const filters = {};
    if (type) filters.type = type;
    if (featured === 'true') filters.isFeatured = true;
    if (available !== 'false') filters.isAvailable = true;

    // Search by title
    if (q) {
      filters.title = { $containsi: q };
    }

    ctx.query = {
      ...ctx.query,
      filters: { ...ctx.query.filters, ...filters },
      populate: ['poster', 'backdrop', 'video'],
    };

    const { data, meta } = await super.find(ctx);
    return { data, meta };
  },

  // Override findOne to populate relations
  async findOne(ctx) {
    ctx.query = {
      ...ctx.query,
      populate: ['poster', 'backdrop', 'video'],
    };

    const response = await super.findOne(ctx);
    return response;
  },
}));
