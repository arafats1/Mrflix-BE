'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::purchase.purchase', ({ strapi }) => ({
  // Only allow users to see their own purchases
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    ctx.query = {
      ...ctx.query,
      filters: {
        ...ctx.query.filters,
        buyer: ctx.state.user.id,
      },
      populate: ['movie', 'movie.poster'],
    };

    const { data, meta } = await super.find(ctx);
    return { data, meta };
  },

  // Create a purchase (buy a movie)
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;

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

    // Check if already purchased
    const existing = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: ctx.state.user.id,
        movie: movie.id,
        status: 'completed',
      },
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already own this movie');
    }

    // Simulate payment (in production, integrate with MTN MoMo / Airtel Money API)
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create purchase
    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: {
        movie: movie.id,
        buyer: ctx.state.user.id,
        amount: movie.priceUGX,
        paymentMethod,
        paymentPhone,
        transactionId,
        status: 'completed', // Simulated - set to 'pending' in production
      },
    });

    return { data: purchase, transactionId };
  },
}));
