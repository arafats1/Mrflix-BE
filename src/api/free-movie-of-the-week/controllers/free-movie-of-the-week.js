'use strict';

/**
 * Free Movie of the Week Controller
 * Auto-rotates weekly or allows admin override
 */
module.exports = {
  // GET /free-movie-of-the-week — Public: Get current free movie
  async find(ctx) {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

    if (!settings?.freeMovieOfWeekEnabled) {
      return { data: { enabled: false, movie: null, expiresAt: null } };
    }

    let movieId = settings.freeMovieOfWeekId;
    let expiresAt = settings.freeMovieOfWeekExpiresAt;
    const now = new Date();

    // Check if the current selection has expired or no selection exists
    if (!movieId || !expiresAt || new Date(expiresAt) <= now) {
      // Auto-select a new free movie for this week
      const movies = await strapi.entityService.findMany('api::movie.movie', {
        filters: { isAvailable: true },
        sort: [{ watchCount: 'desc' }, { createdAt: 'desc' }],
        limit: 20,
      });

      if (movies.length === 0) {
        return { data: { enabled: true, movie: null, expiresAt: null } };
      }

      // Pick a random movie from the top 20 most-watched (to keep it interesting)
      const selected = movies[Math.floor(Math.random() * Math.min(movies.length, 10))];
      movieId = selected.documentId || String(selected.id);

      // Set expiry to next Monday at midnight
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (7 - now.getDay() + 1) % 7 || 7);
      nextMonday.setHours(0, 0, 0, 0);
      expiresAt = nextMonday.toISOString();

      // Persist the selection
      await strapi.entityService.update('api::site-setting.site-setting', settings.id, {
        data: {
          freeMovieOfWeekId: movieId,
          freeMovieOfWeekExpiresAt: expiresAt,
        },
      });
    }

    // Fetch the full movie data
    try {
      // Use findMany with documentId filter (Strapi v5 entityService.findOne expects numeric id)
      const results = await strapi.entityService.findMany('api::movie.movie', {
        filters: { documentId: movieId },
        populate: ['poster', 'backdrop'],
        limit: 1,
      });

      const movie = results?.[0] || null;

      if (!movie) {
        return { data: { enabled: true, movie: null, expiresAt } };
      }

      return {
        data: {
          enabled: true,
          movie: movie.toJSON ? movie.toJSON() : movie,
          expiresAt,
        },
      };
    } catch {
      return { data: { enabled: true, movie: null, expiresAt } };
    }
  },

  // PUT /free-movie-of-the-week — Admin: Override or toggle
  async update(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can manage free movie of the week');
    }

    const { movieId, enabled } = ctx.request.body.data || ctx.request.body;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

    const updateData = {};

    if (typeof enabled === 'boolean') {
      updateData.freeMovieOfWeekEnabled = enabled;
    }

    if (movieId) {
      // Verify movie exists (use findMany with documentId filter for Strapi v5 compat)
      const results = await strapi.entityService.findMany('api::movie.movie', {
        filters: { documentId: movieId },
        limit: 1,
      });
      if (!results || results.length === 0) {
        return ctx.notFound('Movie not found');
      }

      updateData.freeMovieOfWeekId = movieId;
      // Reset expiry to next Monday
      const now = new Date();
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (7 - now.getDay() + 1) % 7 || 7);
      nextMonday.setHours(0, 0, 0, 0);
      updateData.freeMovieOfWeekExpiresAt = nextMonday.toISOString();
    }

    await strapi.entityService.update('api::site-setting.site-setting', settings.id, {
      data: updateData,
    });

    return { data: { success: true } };
  },
};
