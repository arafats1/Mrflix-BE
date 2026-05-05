'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const MIN_WATCHED_SECONDS = 4 * 60;
const MOVIE_POPULATE = {
  fields: ['title', 'type', 'posterUrl', 'backdropUrl', 'documentId', 'isLuganda', 'vjName'],
  populate: {
    poster: {
      fields: ['url'],
    },
    backdrop: {
      fields: ['url'],
    },
  },
};

async function resolveOwnedChildProfile(strapi, userId, childProfileId) {
  if (!childProfileId) return null;

  const where = {
    parent: { id: userId },
  };

  if (/^\d+$/.test(String(childProfileId))) {
    where.id = Number(childProfileId);
  } else {
    where.documentId = String(childProfileId);
  }

  return strapi.db.query('api::child-profile.child-profile').findOne({ where });
}

function mapStream(stream) {
  return {
    id: stream.documentId || stream.id,
    childProfile: stream.childProfile
      ? {
          id: stream.childProfile.id,
          documentId: stream.childProfile.documentId,
          name: stream.childProfile.name,
          avatarUrl: stream.childProfile.avatarUrl || null,
        }
      : null,
    movie: {
      id: stream.movie?.documentId || stream.movie?.id,
      title: stream.movie?.title,
      type: stream.movie?.type,
      posterUrl: stream.movie?.posterUrl,
      backdropUrl: stream.movie?.backdropUrl,
      poster: stream.movie?.poster,
      backdrop: stream.movie?.backdrop,
      isLuganda: stream.movie?.isLuganda || false,
      vjName: stream.movie?.vjName || '',
    },
    contentType: stream.contentType,
    episodeSeason: stream.episodeSeason,
    episodeNumber: stream.episodeNumber,
    platform: stream.platform,
    startedAt: stream.startedAt,
    endedAt: stream.endedAt,
    lastHeartbeat: stream.lastHeartbeat,
    progress: stream.progress || 0,
    watchedSeconds: stream.watchedSeconds || 0,
    positionSeconds: stream.positionSeconds || 0,
    status: stream.status,
    accessType: stream.accessType || 'purchased',
  };
}

function getActivityStamp(stream) {
  return stream.updatedAt || stream.lastHeartbeat || stream.endedAt || stream.startedAt || null;
}

function mapContinueWatchingStream(stream) {
  return {
    id: stream.documentId || stream.id,
    childProfile: stream.childProfile
      ? {
          id: stream.childProfile.id,
          documentId: stream.childProfile.documentId,
          name: stream.childProfile.name,
          avatarUrl: stream.childProfile.avatarUrl || null,
        }
      : null,
    movie: {
      id: stream.movie?.documentId || stream.movie?.id,
      title: stream.movie?.title,
      type: stream.movie?.type,
      posterUrl: stream.movie?.posterUrl,
      backdropUrl: stream.movie?.backdropUrl,
      poster: stream.movie?.poster,
      backdrop: stream.movie?.backdrop,
      isLuganda: stream.movie?.isLuganda || false,
      vjName: stream.movie?.vjName || '',
    },
    contentType: stream.contentType || 'movie',
    episodeSeason: stream.episodeSeason || null,
    episodeNumber: stream.episodeNumber || null,
    status: stream.status,
    progress: {
      percentage: stream.progress || 0,
      positionSeconds: stream.positionSeconds || 0,
      watchedSeconds: stream.watchedSeconds || 0,
      updatedAt: getActivityStamp(stream),
      completed: (stream.progress || 0) >= 90,
    },
  };
}

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

    const { movieId, contentType, episodeSeason, episodeNumber, platform, progress, accessType, deviceId, childProfileId, watchedSeconds, positionSeconds } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    const now = new Date().toISOString();
    const progressVal = typeof progress === 'number' ? Math.min(100, Math.max(0, Math.round(progress))) : null;
    const watchedSecondsVal = typeof watchedSeconds === 'number' ? Math.max(0, Math.round(watchedSeconds)) : null;
    const positionSecondsVal = typeof positionSeconds === 'number' ? Math.max(0, Math.round(positionSeconds)) : null;
    const validAccessTypes = ['purchased', 'subscription', 'free_trial', 'free_movie_of_week'];
    const accessTypeVal = validAccessTypes.includes(accessType) ? accessType : 'purchased';
    const childProfile = await resolveOwnedChildProfile(strapi, ctx.state.user.id, childProfileId);

    if (childProfileId && !childProfile) {
      return ctx.badRequest('Invalid child profile');
    }

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
      if (watchedSecondsVal !== null) updateData.watchedSeconds = Math.max(existing[0].watchedSeconds || 0, watchedSecondsVal);
      if (positionSecondsVal !== null) updateData.positionSeconds = positionSecondsVal;
      if (childProfile) updateData.childProfile = childProfile.documentId || childProfile.id;

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
          watchedSeconds: watchedSecondsVal || 0,
          positionSeconds: positionSecondsVal || 0,
          accessType: accessTypeVal,
          deviceId: deviceId || null,
          childProfile: childProfile ? (childProfile.documentId || childProfile.id) : null,
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

    const { progress, deviceId, watchedSeconds, positionSeconds } = ctx.request.body?.data || ctx.request.body || {};
    const now = new Date().toISOString();
    const progressVal = typeof progress === 'number' ? Math.min(100, Math.max(0, Math.round(progress))) : null;
    const watchedSecondsVal = typeof watchedSeconds === 'number' ? Math.max(0, Math.round(watchedSeconds)) : null;
    const positionSecondsVal = typeof positionSeconds === 'number' ? Math.max(0, Math.round(positionSeconds)) : null;

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
          watchedSeconds: watchedSecondsVal !== null ? Math.max(stream.watchedSeconds || 0, watchedSecondsVal) : (stream.watchedSeconds || 0),
          positionSeconds: positionSecondsVal !== null ? positionSecondsVal : (stream.positionSeconds || 0),
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
        movie: MOVIE_POPULATE,
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
        watchedSeconds: s.watchedSeconds || 0,
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
        movie: MOVIE_POPULATE,
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
        watchedSeconds: s.watchedSeconds || 0,
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

  async parentHistory(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    if (!ctx.state.user.isParent) {
      return ctx.forbidden('Only parent accounts can view child watch history');
    }

    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: {
        childProfile: { parent: { id: ctx.state.user.id } },
        watchedSeconds: { $gte: MIN_WATCHED_SECONDS },
      },
      populate: {
        childProfile: { fields: ['name', 'avatarUrl', 'documentId'] },
        movie: MOVIE_POPULATE,
      },
      sort: 'lastHeartbeat:desc',
      limit: 500,
    });

    const deduped = [];
    const seen = new Set();
    for (const stream of streams) {
      const key = [
        stream.childProfile?.documentId || stream.childProfile?.id || 'none',
        stream.movie?.documentId || stream.movie?.id || 'none',
        stream.contentType || 'movie',
        stream.episodeSeason || 0,
        stream.episodeNumber || 0,
      ].join(':');

      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(mapStream(stream));
    }

    return {
      data: deduped,
      meta: {
        total: deduped.length,
        minimumWatchedSeconds: MIN_WATCHED_SECONDS,
      },
    };
  },

  async continueWatching(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const includeCompleted = ['1', 'true', 'yes'].includes(String(ctx.query.includeCompleted || '').toLowerCase());
    const requestedMovieId = ctx.query.movieId ? String(ctx.query.movieId) : '';
    const childProfileId = ctx.query.childProfileId ? String(ctx.query.childProfileId) : '';
    const childProfile = childProfileId
      ? await resolveOwnedChildProfile(strapi, ctx.state.user.id, childProfileId)
      : null;

    if (childProfileId && !childProfile) {
      return ctx.badRequest('Invalid child profile');
    }

    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const staleStreams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: {
        user: { id: ctx.state.user.id },
        status: 'watching',
        lastHeartbeat: { $lt: twoMinAgo },
      },
      fields: ['documentId', 'lastHeartbeat'],
      limit: 200,
    });
    for (const stale of staleStreams) {
      await strapi.documents('api::active-stream.active-stream').update({
        documentId: stale.documentId,
        data: { status: 'abandoned', endedAt: stale.lastHeartbeat },
      });
    }

    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: {
        user: { id: ctx.state.user.id },
        progress: { $gt: 0 },
      },
      populate: {
        childProfile: { fields: ['name', 'avatarUrl', 'documentId'] },
        movie: MOVIE_POPULATE,
      },
      sort: ['updatedAt:desc', 'lastHeartbeat:desc', 'endedAt:desc'],
      limit: 500,
    });

    const filtered = streams.filter((stream) => {
      const streamMovieId = String(stream.movie?.documentId || stream.movie?.id || '');
      if (requestedMovieId && streamMovieId !== requestedMovieId) return false;

      const streamChildId = String(stream.childProfile?.documentId || stream.childProfile?.id || '');
      if (childProfile) {
        const requestedChildId = String(childProfile.documentId || childProfile.id);
        if (streamChildId !== requestedChildId) return false;
      } else if (stream.childProfile) {
        return false;
      }

      if (!includeCompleted && (stream.progress || 0) >= 90) return false;
      return true;
    });

    const deduped = [];
    const seen = new Set();
    for (const stream of filtered) {
      const key = [
        stream.childProfile?.documentId || stream.childProfile?.id || 'parent',
        stream.movie?.documentId || stream.movie?.id || 'none',
        stream.contentType || 'movie',
        stream.episodeSeason || 0,
        stream.episodeNumber || 0,
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(mapContinueWatchingStream(stream));
    }

    return {
      data: deduped,
      meta: {
        total: deduped.length,
        includeCompleted,
      },
    };
  },

  async dismiss(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const body = ctx.request.body?.data || ctx.request.body || {};
    const movieId = body.movieId ? String(body.movieId) : '';
    const childProfileId = body.childProfileId ? String(body.childProfileId) : '';
    const childProfile = childProfileId
      ? await resolveOwnedChildProfile(strapi, ctx.state.user.id, childProfileId)
      : null;

    if (!movieId) {
      return ctx.badRequest('movieId is required');
    }
    if (childProfileId && !childProfile) {
      return ctx.badRequest('Invalid child profile');
    }

    const episodeSeason = Number.isFinite(Number(body.episodeSeason)) ? Number(body.episodeSeason) : null;
    const episodeNumber = Number.isFinite(Number(body.episodeNumber)) ? Number(body.episodeNumber) : null;

    const streams = await strapi.documents('api::active-stream.active-stream').findMany({
      filters: {
        user: { id: ctx.state.user.id },
      },
      populate: {
        childProfile: { fields: ['documentId'] },
        movie: { fields: ['documentId'] },
      },
      fields: ['documentId', 'contentType', 'episodeSeason', 'episodeNumber'],
      limit: 500,
    });

    const requestedChildId = childProfile ? String(childProfile.documentId || childProfile.id) : '';
    const matches = streams.filter((stream) => {
      const streamMovieId = String(stream.movie?.documentId || stream.movie?.id || '');
      if (streamMovieId !== movieId) return false;
      const streamChildId = String(stream.childProfile?.documentId || stream.childProfile?.id || '');
      if (requestedChildId) {
        if (streamChildId !== requestedChildId) return false;
      } else if (stream.childProfile) {
        return false;
      }
      if (episodeSeason !== null && Number(stream.episodeSeason || 0) !== episodeSeason) return false;
      if (episodeNumber !== null && Number(stream.episodeNumber || 0) !== episodeNumber) return false;
      return true;
    });

    for (const stream of matches) {
      await strapi.documents('api::active-stream.active-stream').delete({
        documentId: stream.documentId,
      });
    }

    return {
      data: {
        ok: true,
        deletedCount: matches.length,
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
