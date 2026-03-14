'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

/**
 * Helper: fetch site-setting default prices once and cache for the request.
 */
async function getSiteDefaultPrices(strapi) {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  return {
    moviePrice: settings?.moviePrice ?? 2000,
    seriesPrice: settings?.seriesPrice ?? 5000,
  };
}

/**
 * Apply the site-setting default price to each movie entry.
 * If the movie has no custom priceUGX (null/0), it uses the default.
 * Also overrides priceUGX so the displayed price always matches the
 * site-setting default for the movie's type.
 */
function applyDefaultPrices(movies, defaults) {
  if (!Array.isArray(movies)) return movies;
  return movies.map((movie) => {
    const m = movie.toJSON ? movie.toJSON() : { ...movie };
    const defaultPrice = m.type === 'series' ? defaults.seriesPrice : defaults.moviePrice;
    m.priceUGX = defaultPrice;
    return m;
  });
}

module.exports = createCoreController('api::movie.movie', ({ strapi }) => ({
  // Override find to add custom filtering and apply site-setting prices
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

    // Apply site-setting default prices
    const defaults = await getSiteDefaultPrices(strapi);
    return { data: applyDefaultPrices(data, defaults), meta };
  },

  // Override findOne to populate relations and apply site-setting price
  async findOne(ctx) {
    ctx.query = {
      ...ctx.query,
      populate: ['poster', 'backdrop', 'video'],
    };

    const response = await super.findOne(ctx);

    // Apply site-setting default price to single movie
    if (response?.data) {
      const defaults = await getSiteDefaultPrices(strapi);
      const m = response.data.toJSON ? response.data.toJSON() : { ...response.data };
      const defaultPrice = m.type === 'series' ? defaults.seriesPrice : defaults.moviePrice;
      m.priceUGX = defaultPrice;
      response.data = m;
    }

    return response;
  },

  // Most Watched: Return movies sorted by watchCount descending
  async mostWatched(ctx) {
    const limit = Math.min(parseInt(ctx.query.limit) || 12, 50);

    const entries = await strapi.entityService.findMany('api::movie.movie', {
      filters: { isAvailable: true },
      sort: [{ watchCount: 'desc' }, { createdAt: 'desc' }],
      populate: ['poster', 'backdrop'],
      limit,
    });

    const defaults = await getSiteDefaultPrices(strapi);
    return { data: applyDefaultPrices(entries, defaults) };
  },

  // Increment watch count for a movie (called when user starts watching)
  async incrementWatch(ctx) {
    const { id } = ctx.params;

    try {
      let movie = null;

      // Accept both numeric Strapi ids and documentIds from clients.
      if (/^\d+$/.test(String(id))) {
        movie = await strapi.entityService.findOne('api::movie.movie', id);
      } else {
        const list = await strapi.entityService.findMany('api::movie.movie', {
          filters: { documentId: String(id) },
          limit: 1,
        });
        movie = list?.[0] || null;
      }

      if (!movie) return ctx.notFound('Movie not found');

      await strapi.entityService.update('api::movie.movie', movie.id, {
        data: { watchCount: (movie.watchCount || 0) + 1 },
      });

      return { data: { success: true } };
    } catch (err) {
      strapi.log.error('Increment watch error:', err);
      return ctx.badRequest('Failed to update watch count');
    }
  },
}));
