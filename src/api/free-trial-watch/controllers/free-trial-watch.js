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

    // Find the movie early so exact-match replay checks use the same numeric id
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Already-recorded content must remain replayable even when the user has no
    // remaining trial credits.
    const alreadyWatched = existing.some(w => {
      const sameMovie = String(w.movie?.id || w.movie) === String(movie.id);
      if (contentType === 'episode') {
        return sameMovie && w.episodeSeason === episodeSeason && w.episodeNumber === episodeNumber;
      }
      return sameMovie && w.contentType === 'movie';
    });

    if (alreadyWatched) {
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

    if (existing.length >= freeTrialCount) {
      // Check if this is the free movie of the week — always allow
      try {
        const settings2 = await strapi.entityService.findMany('api::site-setting.site-setting');
        if (settings2?.freeMovieOfWeekEnabled && settings2?.freeMovieOfWeekId === movieId) {
          return {
            data: {
              alreadyRecorded: true,
              isFreeMovieOfWeek: true,
              freeTrialCount,
              used: existing.length,
              remaining: 0,
            },
          };
        }
      } catch (e) { /* ignore */ }
      return ctx.badRequest('Free trial limit reached. Please purchase or subscribe.');
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

    // Create a free purchase so the content stays in the user's library.
    // For episodes, paymentMethod='free_trial' + seasonNumber is used — the frontend
    // access checks exclude free_trial purchases from granting full-season access.
    try {
      await strapi.documents('api::purchase.purchase').create({
        data: {
          buyer: ctx.state.user.id,
          movie: movie.id,
          amount: 0,
          paymentMethod: 'free_trial',
          transactionId: `TRIAL_${ctx.state.user.id}_${movie.id}_${contentType === 'episode' ? `S${episodeSeason}E${episodeNumber}_` : ''}${Date.now()}`,
          status: 'completed',
          downloadCount: 0,
          seasonNumber: episodeSeason || null,
        },
      });
    } catch (err) {
      strapi.log.error('Failed to create trial purchase record:', err);
    }

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

    // Even if trial is exhausted, allow the free movie of the week
    if (!canWatch) {
      try {
        const settings2 = await strapi.entityService.findMany('api::site-setting.site-setting');
        if (settings2?.freeMovieOfWeekEnabled && settings2?.freeMovieOfWeekId === movieId) {
          return {
            data: {
              canWatch: true,
              isFreeMovieOfWeek: true,
              freeTrialCount,
              used,
              remaining: 0,
            },
          };
        }
      } catch (e) { /* ignore */ }
    }

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

  /**
   * GET /free-trial-watches/admin-list
   * Admin: Returns all trial watch records grouped by user
   */
  async adminList(ctx) {
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

    // Fetch ALL trial watch records
    const watches = await strapi.documents('api::free-trial-watch.free-trial-watch').findMany({
      populate: {
        user: { fields: ['username', 'email'] },
        movie: { fields: ['title', 'type', 'posterUrl', 'documentId'] },
      },
      sort: 'createdAt:desc',
      limit: 1000,
    });

    const activeUserWatches = [];
    for (const watch of watches) {
      if (watch.user?.id) {
        activeUserWatches.push(watch);
      }
    }

    const userMap = /** @type {Record<string, any>} */ ({});

    for (const watch of activeUserWatches) {
      const userId = String(watch.user.id);

      if (!userMap[userId]) {
        userMap[userId] = {
          userId,
          username: watch.user?.username || 'Unknown',
          email: watch.user?.email || '',
          used: 0,
          watches: [],
        };
      }

      userMap[userId].used += 1;
      userMap[userId].watches.push({
        id: watch.documentId || watch.id,
        movieId: watch.movie?.documentId || watch.movie?.id,
        movieTitle: watch.movie?.title,
        movieType: watch.movie?.type,
        posterUrl: watch.movie?.posterUrl || null,
        contentType: watch.contentType,
        episodeSeason: watch.episodeSeason,
        episodeNumber: watch.episodeNumber,
        createdAt: watch.createdAt,
      });
    }


    // Convert to array and add remaining count
    const users = Object.values(userMap).map(u => ({
      ...u,
      remaining: Math.max(0, freeTrialCount - u.used),
      freeTrialCount,
    }));

    return {
      data: {
        freeTrialCount,
        totalTrialUsers: users.length,
        totalWatches: activeUserWatches.length,
        users,
      },
    };
  },
}));
