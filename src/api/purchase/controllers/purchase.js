'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::purchase.purchase', ({ strapi }) => ({
  // Users see their own purchases, admins see all with buyer info
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Check if admin
    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    const filters = {};
    if (!isAdmin) {
      filters.buyer = { id: ctx.state.user.id };
    }

    const populate = isAdmin
      ? { movie: { populate: '*' }, buyer: { populate: '*' } }
      : { movie: { populate: '*' } };

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters,
      populate,
      sort: { createdAt: 'desc' },
    });

    return { data: purchases, meta: { pagination: { total: purchases.length } } };
  },

  // Create a purchase (buy a movie or season)
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, paymentMethod, paymentPhone, seasonNumber } = ctx.request.body.data || ctx.request.body;

    if (!movieId || !paymentMethod || !paymentPhone) {
      return ctx.badRequest('Missing required fields: movieId, paymentMethod, paymentPhone');
    }

    // Get the movie
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Determine filter for existing purchase
    const filters = {
      buyer: ctx.state.user.id,
      movie: movie.id,
      status: 'completed',
    };

    if (movie.type === 'series' && seasonNumber) {
      filters.seasonNumber = seasonNumber;
    }

    // Check if already purchased
    const existing = await strapi.documents('api::purchase.purchase').findMany({
      filters,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already own this ' + (seasonNumber ? `season ${seasonNumber}` : 'movie'));
    }

    // Simulate payment (in production, integrate with MTN MoMo / Airtel Money API)
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create purchase
    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: {
        movie: movie.id,
        buyer: ctx.state.user.id,
        amount: movie.priceUGX || 5000,
        paymentMethod,
        paymentPhone,
        transactionId,
        status: 'completed', // Simulated - set to 'pending' in production
        seasonNumber: (movie.type === 'series' && seasonNumber) ? seasonNumber : null,
      },
    });

    return { data: purchase, transactionId };
  },

  async incrementDownload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing movieId');
    }

    // Find the purchase for this user and movie
    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: ctx.state.user.id,
        movie: { documentId: movieId },
        status: 'completed',
      },
      sort: { createdAt: 'desc' },
      limit: 1,
    });

    if (!purchases || purchases.length === 0) {
      return ctx.notFound('Purchase record not found for this user and movie');
    }

    const purchase = purchases[0];

    // Update the download count
    const updated = await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: {
        downloadCount: (purchase.downloadCount || 0) + 1,
      },
    });

    return { data: updated };
  },
}));
