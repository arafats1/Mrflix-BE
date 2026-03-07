'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::active-stream.active-stream', ({ strapi }) => ({

  /**
   * POST /active-streams/heartbeat
   * Called every 30s by the player to signal "I'm still watching"
   * Body: { movieId, contentType, episodeSeason?, episodeNumber?, platform? }
   */
  async heartbeat(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, contentType, episodeSeason, episodeNumber, platform } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    const now = new Date().toISOString();

    // Look for an existing active-stream record for this user + movie + episode
    const filters = {
      user: { id: ctx.state.user.id },
      movie: { documentId: movieId },
    };
    if (contentType === 'episode' && episodeSeason && episodeNumber) {
      filters.episodeSeason = episodeSeason;
      filters.episodeNumber = episodeNumber;
    }

    const existing = await strapi.documents('api::active-stream.active-stream').findMany({
      filters,
      limit: 1,
    });

    if (existing.length > 0) {
      // Update heartbeat timestamp
      await strapi.documents('api::active-stream.active-stream').update({
        documentId: existing[0].documentId,
        data: { lastHeartbeat: now },
      });
    } else {
      // First clear any old streams from this user (they switched to something else)
      const oldStreams = await strapi.documents('api::active-stream.active-stream').findMany({
        filters: { user: { id: ctx.state.user.id } },
      });
      for (const old of oldStreams) {
        await strapi.documents('api::active-stream.active-stream').delete({ documentId: old.documentId });
      }

      // Create new active stream record
      await strapi.documents('api::active-stream.active-stream').create({
        data: {
          user: ctx.state.user.id,
          movie: movieId,
          contentType: contentType || 'movie',
          episodeSeason: episodeSeason || null,
          episodeNumber: episodeNumber || null,
          lastHeartbeat: now,
          startedAt: now,
          platform: platform || 'web',
        },
      });
    }

    return { data: { ok: true } };
  },

  /**
   * POST /active-streams/stop
   * Called when user leaves the watch page
   * Body: { movieId }
   */
  async stop(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Delete all active streams for this user
    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: { user: { id: ctx.state.user.id } },
    });

    for (const stream of streams) {
      await strapi.documents('api::active-stream.active-stream').delete({ documentId: stream.documentId });
    }

    return { data: { ok: true } };
  },

  /**
   * GET /active-streams/admin-list
   * Admin: Returns all currently active streams (heartbeat within last 2 minutes)
   */
  async adminList(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Clean up stale streams (no heartbeat in 2 minutes)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const staleStreams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: { lastHeartbeat: { $lt: twoMinAgo } },
    });
    for (const stale of staleStreams) {
      await strapi.documents('api::active-stream.active-stream').delete({ documentId: stale.documentId });
    }

    // Fetch all remaining active streams
    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      populate: {
        user: { fields: ['username', 'email'] },
        movie: { fields: ['title', 'type', 'posterUrl', 'documentId'] },
      },
      sort: 'lastHeartbeat:desc',
    });

    return {
      data: streams.map(s => ({
        id: s.documentId || s.id,
        user: {
          id: s.user?.id,
          username: s.user?.username,
          email: s.user?.email,
        },
        movie: {
          id: s.movie?.documentId || s.movie?.id,
          title: s.movie?.title,
          type: s.movie?.type,
          posterUrl: s.movie?.posterUrl,
        },
        contentType: s.contentType,
        episodeSeason: s.episodeSeason,
        episodeNumber: s.episodeNumber,
        platform: s.platform,
        startedAt: s.startedAt,
        lastHeartbeat: s.lastHeartbeat,
      })),
    };
  },
}));
