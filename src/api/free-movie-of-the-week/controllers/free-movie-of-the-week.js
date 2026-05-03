'use strict';

/**
 * Free Movie of the Week Controller
 * Auto-rotates weekly or allows admin override
 */
module.exports = {
  // GET /free-movie-of-the-week — Public: Get current free-watch titles
  async find(ctx) {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

    if (!settings?.freeMovieOfWeekEnabled) {
      return { data: { enabled: false, movies: [], movie: null, expiresAt: null } };
    }

    const selectedIds = Array.isArray(settings.freeWatchMovieIds) && settings.freeWatchMovieIds.length > 0
      ? settings.freeWatchMovieIds.filter(Boolean)
      : (settings.freeMovieOfWeekId ? [settings.freeMovieOfWeekId] : []);
    let expiresAt = settings.freeMovieOfWeekExpiresAt;
    if (selectedIds.length === 0) {
      return { data: { enabled: true, movies: [], movie: null, expiresAt } };
    }

    try {
      const results = await strapi.entityService.findMany('api::movie.movie', {
        filters: { documentId: { $in: selectedIds } },
        populate: ['poster', 'backdrop'],
        limit: selectedIds.length,
      });

      const movies = selectedIds
        .map((selectedId) => results?.find((movie) => String(movie.documentId || movie.id) === String(selectedId)))
        .filter(Boolean)
        .map((movie) => (movie.toJSON ? movie.toJSON() : movie));

      if (movies.length === 0) {
        return { data: { enabled: true, movies: [], movie: null, expiresAt } };
      }

      return {
        data: {
          enabled: true,
          movies,
          movie: movies[0],
          expiresAt,
        },
      };
    } catch {
      return { data: { enabled: true, movies: [], movie: null, expiresAt } };
    }
  },

  // PUT /free-movie-of-the-week — Admin: manage free-watch titles
  async update(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can manage free movie of the week');
    }

    const { movieId, movieIds, enabled } = ctx.request.body.data || ctx.request.body;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

    const updateData = {};

    if (typeof enabled === 'boolean') {
      updateData.freeMovieOfWeekEnabled = enabled;
    }

    const requestedIds = Array.isArray(movieIds)
      ? movieIds.filter(Boolean)
      : movieId
        ? [movieId]
        : null;

    if (requestedIds) {
      const results = await strapi.entityService.findMany('api::movie.movie', {
        filters: { documentId: { $in: requestedIds } },
        limit: requestedIds.length,
      });
      if (!results || results.length !== requestedIds.length) {
        return ctx.notFound('Movie not found');
      }

      updateData.freeWatchMovieIds = requestedIds;
      updateData.freeMovieOfWeekId = requestedIds[0] || null;
      updateData.freeMovieOfWeekExpiresAt = null;
    }

    await strapi.entityService.update('api::site-setting.site-setting', settings.id, {
      data: updateData,
    });

    return { data: { success: true, movieIds: updateData.freeWatchMovieIds || settings.freeWatchMovieIds || [] } };
  },
};
