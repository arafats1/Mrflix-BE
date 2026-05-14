'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::entrep-product.entrep-product', ({ strapi }) => ({
  async find(ctx) {
    const list = await strapi.entityService.findMany('api::entrep-product.entrep-product', {
      filters: { status: 'approved' },
      sort: { createdAt: 'desc' },
      populate: ['seller'],
    });
    ctx.send({ data: list });
  },
  async createProduct(ctx) {
    if (!ctx.state.user?.id) return ctx.unauthorized();
    const userId = ctx.state.user.id;
    const profileList = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: { user: userId }, limit: 1,
    });
    const profile = profileList?.[0];
    const b = ctx.request.body || {};
    if (!b.name) return ctx.badRequest('name required');
    const product = await strapi.entityService.create('api::entrep-product.entrep-product', {
      data: {
        name: b.name, description: b.description, priceUGX: b.priceUGX || 0,
        category: b.category, imageUrls: b.imageUrls || [], emoji: b.emoji,
        seller: profile?.id || null, sellerName: profile?.fullName || ctx.state.user.username,
        stock: b.stock || 1, status: 'approved',
      },
    });
    ctx.send({ product });
  },
}));
