'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::active-stream.active-stream', ({ strapi }) => ({

  /**
   * POST /active-streams/heartbeat
   * Called every 30s by the player to signal "I'm still watching"
   * Body: { movieId, contentType, episodeSeason?, episodeNumber?, platform?, progress?, deviceId? }
   */
  async heartbeat(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, contentType, episodeSeason, episodeNumber, platform, progress, accessType, deviceId } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    const now = new Date().toISOString();
    const progressVal = typeof progress === 'number' ? Math.min(100, Math.max(0, Math.round(progress))) : null;
    const validAccessTypes = ['purchased', 'subscription', 'free_trial', 'free_movie_of_week'];
    const accessTypeVal = validAccessTypes.includes(accessType) ? accessType : 'purchased';

    // Look for an existing ACTIVE stream for this user + movie + episode + device
    const filters = {
      user: { id: ctx.state.user.id },
      movie: { documentId: movieId },
      status: 'watching',
    };
    if (contentType === 'episode' && episodeSeason && episodeNumber) {
      filters.episodeSeason = episodeSeason;
      filters.episodeNumber = episodeNumber;
    }
    if (deviceId) {
      filters.deviceId = deviceId;
    }

    const existing = await strapi.documents('api::active-stream.active-stream').findMany({
      filters,
      limit: 1,
    });

    if (existing.length > 0) {
      // Update heartbeat timestamp and progress
      const updateData = { lastHeartbeat: now };
      if (progressVal !== null) updateData.progress = progressVal;
      
      // Auto-mark as completed ONLY IF progress is 100% or very close (e.g., 98%)
      if (progressVal >= 98) {
        updateData.status = 'completed';
        updateData.endedAt = now;
      }
      
      await strapi.documents('api::active-stream.active-stream').update({
        documentId: existing[0].documentId,
        data: updateData,
      });
    } else {
      // This is a new stream — check device limit before creating
      // First, stop any other ACTIVE streams from this SAME device (user switched content on same device)
      if (deviceId) {
        const sameDeviceStreams = await strapi.documents('api::active-stream.active-stream').findMany({
          filters: { user: { id: ctx.state.user.id }, status: 'watching', deviceId },
        });
        for (const old of sameDeviceStreams) {
          await strapi.documents('api::active-stream.active-stream').update({
            documentId: old.documentId,
            data: { status: 'stopped', endedAt: now },
          });
        }
      }

      // Count active streams from OTHER devices for this user
      const allActiveStreams = await strapi.documents('api::active-stream.active-stream').findMany({
        filters: { user: { id: ctx.state.user.id }, status: 'watching' },
      });
      // Get unique device IDs currently streaming (excluding the current device)
      const otherDeviceStreams = deviceId
        ? allActiveStreams.filter(s => s.deviceId && s.deviceId !== deviceId)
        : allActiveStreams;
      const uniqueOtherDevices = new Set(otherDeviceStreams.map(s => s.deviceId).filter(Boolean));

      // Limit: max 2 devices per user
      if (uniqueOtherDevices.size >= 2) {
        return ctx.forbidden('Device limit exceeded. You can only stream on 2 devices at the same time. Please stop playback on another device first.', {
          data: {
            error: 'DEVICE_LIMIT_EXCEEDED',
            maxDevices: 2,
            activeDevices: uniqueOtherDevices.size + (deviceId ? 0 : 0),
          },
        });
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
          status: 'watching',
          progress: progressVal || 0,
          accessType: accessTypeVal,
          deviceId: deviceId || null,
        },
      });
    }

    return { data: { ok: true } };
  },

  /**
   * POST /active-streams/stop
   * Called when user leaves the watch page
   * Body: { progress?, deviceId? }
   */
  async stop(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { progress, deviceId } = ctx.request.body?.data || ctx.request.body || {};
    const now = new Date().toISOString();
    const progressVal = typeof progress === 'number' ? Math.min(100, Math.max(0, Math.round(progress))) : null;

    // If deviceId is provided, only stop streams for that device; otherwise stop all
    const filters = { user: { id: ctx.state.user.id }, status: 'watching' };
    if (deviceId) {
      filters.deviceId = deviceId;
    }

    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters,
    });

    for (const stream of streams) {
      const finalProgress = progressVal !== null ? progressVal : (stream.progress || 0);
      // When stopping, 90% is the threshold for 'completed' (history)
      await strapi.documents('api::active-stream.active-stream').update({
        documentId: stream.documentId,
        data: {
          status: finalProgress >= 90 ? 'completed' : 'stopped',
          endedAt: now,
          progress: finalProgress,
        },
      });
    }

    return { data: { ok: true } };
  },

  /**
   * GET /active-streams/admin-list
   * Admin: Returns all currently active streams (status = watching, heartbeat within last 2 min)
   */
  async adminList(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Mark stale streams as "abandoned" (no heartbeat in 2 minutes)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const staleStreams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: { status: 'watching', lastHeartbeat: { $lt: twoMinAgo } },
    });
    for (const stale of staleStreams) {
      await strapi.documents('api::active-stream.active-stream').update({
        documentId: stale.documentId,
        data: { status: 'abandoned', endedAt: stale.lastHeartbeat },
      });
    }

    // Fetch all currently watching streams
    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: { status: 'watching' },
      populate: {
        user: { fields: ['username', 'email'] },
        movie: { fields: ['title', 'type', 'posterUrl', 'documentId', 'isLuganda', 'vjName'] },
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
          isLuganda: s.movie?.isLuganda || false,
          vjName: s.movie?.vjName || '',
        },
        contentType: s.contentType,
        episodeSeason: s.episodeSeason,
        episodeNumber: s.episodeNumber,
        platform: s.platform,
        startedAt: s.startedAt,
        lastHeartbeat: s.lastHeartbeat,
        progress: s.progress || 0,
        status: s.status,
        accessType: s.accessType || 'purchased',
        deviceId: s.deviceId || null,
      })),
    };
  },

  /**
   * GET /active-streams/admin-history
   * Admin: Returns recent watch sessions (completed, stopped, abandoned)
   */
  async adminHistory(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const page = parseInt(ctx.query.page) || 1;
    const pageSize = parseInt(ctx.query.pageSize) || 50;
    const statusFilter = ctx.query.status || null; // completed, stopped, abandoned, or null for all

    const filters = {
      status: { $ne: 'watching' },
    };
    if (statusFilter && ['completed', 'stopped', 'abandoned'].includes(statusFilter)) {
      filters.status = statusFilter;
    }

    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters,
      populate: {
        user: { fields: ['username', 'email'] },
        movie: { fields: ['title', 'type', 'posterUrl', 'documentId', 'isLuganda', 'vjName'] },
      },
      sort: 'endedAt:desc',
      start: (page - 1) * pageSize,
      limit: pageSize,
    });

    // Get total count for pagination
    const allHistory = await strapi.documents('api::active-stream.active-stream').findMany({
      filters,
      fields: ['id'],
      limit: 10000,
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
          isLuganda: s.movie?.isLuganda || false,
          vjName: s.movie?.vjName || '',
        },
        contentType: s.contentType,
        episodeSeason: s.episodeSeason,
        episodeNumber: s.episodeNumber,
        platform: s.platform,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        progress: s.progress || 0,
        status: s.status,
        accessType: s.accessType || 'purchased',
      })),
      meta: {
        total: allHistory.length,
        page,
        pageSize,
      },
    };
  },

  /**
   * POST /active-streams/clear-history
   * Admin: Deletes all watch sessions except currently ACTIVE ones
   */
  async clearHistory(ctx) {
    if (!ctx.state.user || (ctx.state.user.role?.type !== 'admin' && ctx.state.user.role?.name !== 'Admin')) {
      return ctx.unauthorized('Admin only');
    }

    const { status } = ctx.request.body?.data || ctx.request.body || {};

    const filters = {
      status: { $ne: 'watching' },
    };

    if (status && ['completed', 'stopped', 'abandoned'].includes(status)) {
      filters.status = status;
    }

    try {
      const records = await strapi.documents('api::active-stream.active-stream').findMany({
        filters,
        fields: ['id'],
        limit: 10000,
      });

      let deletedCount = 0;
      for (const record of records) {
        await strapi.documents('api::active-stream.active-stream').delete({
          documentId: record.documentId,
        });
        deletedCount++;
      }

      return {
        data: {
          ok: true,
          deletedCount,
          message: `Successfully cleared ${deletedCount} history records`,
        },
      };
    } catch (err) {
      return ctx.internalServerError('Failed to clear history');
    }
  },
}));
