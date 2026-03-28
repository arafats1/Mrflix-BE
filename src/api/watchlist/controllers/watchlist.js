'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::watchlist.watchlist', ({ strapi }) => ({
  // Get current user's watchlist
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const entries = await strapi.documents('api::watchlist.watchlist').findMany({
      filters: { user: { id: ctx.state.user.id } },
      populate: { movie: { populate: '*' } },
      sort: { createdAt: 'desc' },
    });

    return { data: entries };
  },

  // Add a movie to watchlist
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId } = ctx.request.body.data || ctx.request.body;
    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    // Find the movie
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });
    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Check if already in watchlist
    const existing = await strapi.documents('api::watchlist.watchlist').findMany({
      filters: {
        user: { id: ctx.state.user.id },
        movie: { id: movie.id },
      },
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('Movie is already in your watchlist');
    }

    const entry = await strapi.documents('api::watchlist.watchlist').create({
      data: {
        user: ctx.state.user.id,
        movie: movie.id,
      },
      populate: { movie: { populate: '*' } },
      status: 'published',
    });

    return { data: entry };
  },

  // Remove a movie from watchlist
  async delete(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { id } = ctx.params; // This is the movieId (documentId)

    // Find the movie first
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: id,
    });
    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Find the watchlist entry for this user + movie
    const entries = await strapi.documents('api::watchlist.watchlist').findMany({
      filters: {
        user: { id: ctx.state.user.id },
        movie: { id: movie.id },
      },
    });

    if (!entries || entries.length === 0) {
      return ctx.notFound('Movie not in your watchlist');
    }

    // Delete all matching entries (should be just one)
    for (const entry of entries) {
      await strapi.documents('api::watchlist.watchlist').delete({
        documentId: entry.documentId,
      });
    }

    return { data: { message: 'Removed from watchlist' } };
  },
}));
