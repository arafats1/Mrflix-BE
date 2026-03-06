'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::free-trial-watch.free-trial-watch', ({ strapi }) => ({

  /**
   * GET /free-trial-watches/my-status
   * Returns the user's trial usage and remaining count
   */
  async myStatus(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Get freeTrialCount from site settings
    let freeTrialCount = 2;
    try {
      const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
      if (settings?.freeTrialCount != null) {
        freeTrialCount = settings.freeTrialCount;
      }
    } catch (e) { /* use default */ }

    // Count how many free trial watches this user has used
    const watches = await strapi.documents('api::free-trial-watch.free-trial-watch').findMany({
      filters: { user: { id: ctx.state.user.id } },
      populate: { movie: { fields: ['title', 'type', 'documentId'] } },
    });

    const used = watches.length;
    const remaining = Math.max(0, freeTrialCount - used);

    return {
      data: {
        freeTrialCount,
        used,
        remaining,
        watches: watches.map(w => ({
          id: w.documentId || w.id,
          movieId: w.movie?.documentId || w.movie?.id,
          movieTitle: w.movie?.title,
          contentType: w.contentType,
          episodeSeason: w.episodeSeason,
          episodeNumber: w.episodeNumber,
          createdAt: w.createdAt,
        })),
      },
    };
  },

  /**
   * POST /free-trial-watches/record
   * Records that the user is using a free trial watch for a movie or episode.
   * Body: { movieId, contentType: "movie"|"episode", episodeSeason?, episodeNumber? }
   */
  async record(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, contentType, episodeSeason, episodeNumber } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    // Get site settings for trial count
    let freeTrialCount = 2;
    try {
      const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
      if (settings?.freeTrialCount != null) {
        freeTrialCount = settings.freeTrialCount;
      }
    } catch (e) { /* use default */ }

    // Count existing usage
    const existing = await strapi.documents('api::free-trial-watch.free-trial-watch').findMany({
      filters: { user: { id: ctx.state.user.id } },
    });

    if (existing.length >= freeTrialCount) {
      return ctx.badRequest('Free trial limit reached. Please purchase or subscribe.');
    }

    // Find the movie
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Check if this exact movie/episode was already recorded
    const alreadyWatched = existing.some(w => {
      const sameMovie = String(w.movie?.id || w.movie) === String(movie.id);
      if (contentType === 'episode') {
        return sameMovie && w.episodeSeason === episodeSeason && w.episodeNumber === episodeNumber;
      }
      return sameMovie && w.contentType === 'movie';
    });

    if (alreadyWatched) {
      // Already recorded — still allow watching, just return current status
      const remaining = Math.max(0, freeTrialCount - existing.length);
      return {
        data: {
          alreadyRecorded: true,
          freeTrialCount,
          used: existing.length,
          remaining,
        },
      };
    }

    // Record the trial watch
    await strapi.documents('api::free-trial-watch.free-trial-watch').create({
      data: {
        user: ctx.state.user.id,
        movie: movie.id,
        contentType: contentType || 'movie',
        episodeSeason: episodeSeason || null,
        episodeNumber: episodeNumber || null,
      },
    });

    const newUsed = existing.length + 1;
    const remaining = Math.max(0, freeTrialCount - newUsed);

    return {
      data: {
        alreadyRecorded: false,
        freeTrialCount,
        used: newUsed,
        remaining,
      },
    };
  },

  /**
   * POST /free-trial-watches/can-watch
   * Checks whether a user can watch a specific movie/episode for free.
   * Body: { movieId, contentType: "movie"|"episode", episodeSeason?, episodeNumber? }
   */
  async canWatch(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, contentType, episodeSeason, episodeNumber } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    // Get site settings for trial count
    let freeTrialCount = 2;
    try {
      const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
      if (settings?.freeTrialCount != null) {
        freeTrialCount = settings.freeTrialCount;
      }
    } catch (e) { /* use default */ }

    if (freeTrialCount <= 0) {
      return { data: { canWatch: false, reason: 'Free trial is disabled', freeTrialCount, used: 0, remaining: 0 } };
    }

    // Count existing usage
    const existing = await strapi.documents('api::free-trial-watch.free-trial-watch').findMany({
      filters: { user: { id: ctx.state.user.id } },
      populate: { movie: true },
    });

    const used = existing.length;

    // Check if this exact content was already watched (doesn't count again)
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    const alreadyWatched = existing.some(w => {
      const sameMovie = String(w.movie?.id || w.movie) === String(movie.id);
      if (contentType === 'episode') {
        return sameMovie && w.episodeSeason === episodeSeason && w.episodeNumber === episodeNumber;
      }
      return sameMovie && w.contentType === 'movie';
    });

    if (alreadyWatched) {
      return { data: { canWatch: true, alreadyRecorded: true, freeTrialCount, used, remaining: Math.max(0, freeTrialCount - used) } };
    }

    const canWatch = used < freeTrialCount;

    return {
      data: {
        canWatch,
        reason: canWatch ? null : 'Free trial limit reached',
        freeTrialCount,
        used,
        remaining: Math.max(0, freeTrialCount - used),
      },
    };
  },
}));
