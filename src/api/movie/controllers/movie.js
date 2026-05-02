'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const ADULT_SEARCH_TERMS = /(^|\b)(adult|18\+|18\s*plus|mature|sex|erotic|explicit)(\b|$)/i;
const TMDB_BASE = 'https://api.themoviedb.org/3';

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

function buildYoutubeUrls(video) {
  if (!video?.key) {
    return {
      url: null,
      embedUrl: null,
    };
  }

  return {
    url: `https://www.youtube.com/watch?v=${video.key}`,
    embedUrl: `https://www.youtube.com/embed/${video.key}`,
  };
}

function pickYoutubeVideo(videos, type) {
  if (!Array.isArray(videos) || videos.length === 0) return null;

  return videos.find((video) => video.site === 'YouTube' && video.type === type && video.official)
    || videos.find((video) => video.site === 'YouTube' && video.type === type)
    || null;
}

async function fetchTmdbPreview(strapi, movie, cache) {
  const tmdbApiKey = process.env.TMDB_API_KEY;
  const tmdbId = movie?.tmdbId;

  if (!tmdbApiKey || !tmdbId) {
    return null;
  }

  const mediaType = movie.type === 'series' ? 'tv' : 'movie';
  const cacheKey = `${mediaType}:${tmdbId}`;

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      try {
        const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/videos?api_key=${tmdbApiKey}&language=en-US`;
        const response = await fetch(url);

        if (!response.ok) {
          return null;
        }

        const payload = await response.json();
        const videos = Array.isArray(payload?.results) ? payload.results : [];
        const teaser = pickYoutubeVideo(videos, 'Teaser');
        const trailer = pickYoutubeVideo(videos, 'Trailer');
        const teaserUrls = buildYoutubeUrls(teaser);
        const trailerUrls = buildYoutubeUrls(trailer);

        return {
          teaserUrl: teaserUrls.url,
          teaserEmbedUrl: teaserUrls.embedUrl,
          trailerEmbedUrl: trailerUrls.embedUrl,
          previewType: teaser ? 'teaser' : trailer ? 'trailer' : null,
        };
      } catch (error) {
        strapi.log.error(`TMDb preview fetch failed for ${cacheKey}:`, error);
        return null;
      }
    })());
  }

  return cache.get(cacheKey);
}

async function enrichMoviesWithPreviews(strapi, movies) {
  if (!Array.isArray(movies) || movies.length === 0) {
    return movies;
  }

  const cache = new Map();
  return Promise.all(
    movies.map(async (movie) => {
      const preview = await fetchTmdbPreview(strapi, movie, cache);
      return preview ? { ...movie, ...preview } : movie;
    })
  );
}

async function enrichMovieWithPreview(strapi, movie) {
  if (!movie) {
    return movie;
  }

  const [enrichedMovie] = await enrichMoviesWithPreviews(strapi, [movie]);
  return enrichedMovie;
}

module.exports = createCoreController('api::movie.movie', ({ strapi }) => ({
  // Override find to add custom filtering and apply site-setting prices
  async find(ctx) {
    // Allow filtering by type, featured, available
    const { type, featured, available, q, luganda, translatedLanguage, includeXXX, includePreviews, includeUnavailable } = ctx.query;

    const filters = {};
    if (type) filters.type = type;
    if (featured === 'true') filters.isFeatured = true;
    // Hide unavailable titles unless the caller explicitly asks for them
    // (admin Content page passes `includeUnavailable=true` to surface hidden items).
    if (available !== 'false' && includeUnavailable !== 'true') {
      filters.isAvailable = true;
    }

    // Translation filtering. Three layers:
    //   ?translatedLanguage=Runyankole  -> only that language
    //   ?luganda=true                    -> only Luganda (legacy alias)
    //   ?luganda=all                     -> include translated content alongside English
    //   (default)                        -> exclude any translated content from English rails
    if (translatedLanguage) {
      filters.translatedLanguage = translatedLanguage;
      if (translatedLanguage === 'Luganda') {
        filters.$or = [
          ...(filters.$or || []),
          { isLuganda: true },
          { translatedLanguage: 'Luganda' },
        ];
        delete filters.translatedLanguage;
      }
    } else if (luganda === 'true') {
      filters.isLuganda = true;
    } else if (luganda === 'all') {
      // no filter — show both
    } else {
      // Default English view: hide Luganda AND any other translated language
      filters.$and = [
        ...(filters.$and || []),
        { $or: [{ isLuganda: false }, { isLuganda: { $null: true } }] },
        { $or: [{ translatedLanguage: { $null: true } }, { translatedLanguage: '' }] },
      ];
    }

    // Search by title, genres, overview, and countryOfOrigin
    if (q) {
      const searchOr = [
        { title: { $containsi: q } },
        { genres: { $containsi: q } },
        { overview: { $containsi: q } },
        { countryOfOrigin: { $containsi: q } },
      ];
      // Adult-intent searches should surface catalog titles marked as Adult 18+.
      if (ADULT_SEARCH_TERMS.test(q)) {
        searchOr.push({ isAdult: true });
      }
      filters.$and = [
        ...(filters.$and || []),
        { $or: searchOr },
      ];
    }

    // Decide whether to include exclusive (XXX) titles in the response.
    // Trust ctx.state.user — only authenticated admins or users with an
    // active exclusive subscription get to see catalog items flagged isXXX.
    let allowXXX = false;
    const requester = ctx.state?.user;
    if (requester) {
      let roleType = requester.role?.type || requester.role?.name;
      if (!roleType) {
        try {
          const fresh = await strapi.entityService.findOne(
            'plugin::users-permissions.user',
            requester.id,
            { populate: ['role'] }
          );
          roleType = fresh?.role?.type || fresh?.role?.name;
        } catch {}
      }
      const isAdmin = roleType === 'admin' || roleType === 'Admin';
      if (isAdmin) {
        allowXXX = true;
      } else {
        try {
          const activeExcl = await strapi.entityService.findMany(
            'api::exclusive-subscription.exclusive-subscription',
            {
              filters: {
                subscriber: { id: requester.id },
                status: 'active',
                endDate: { $gte: new Date().toISOString() },
              },
              limit: 1,
            }
          );
          if (Array.isArray(activeExcl) && activeExcl.length > 0) {
            allowXXX = true;
          }
        } catch (err) {
          strapi.log.warn(`exclusive-sub check failed: ${err.message}`);
        }
      }
      strapi.log.debug(`[movies.find] user=${requester.id} role=${roleType} allowXXX=${allowXXX}`);
    }
    void includeXXX; // accepted for backward-compat but no longer enforced

    if (!allowXXX) {
      filters.$and = [
        ...(filters.$and || []),
        { $or: [{ isXXX: false }, { isXXX: { $null: true } }] },
      ];
    }

    ctx.query = {
      ...ctx.query,
      filters: { ...ctx.query.filters, ...filters },
      populate: ['poster', 'backdrop', 'video'],
    };

    const { data, meta } = await super.find(ctx);

    // Apply site-setting default prices
    const defaults = await getSiteDefaultPrices(strapi);
    let movies = applyDefaultPrices(data, defaults);

    if (includePreviews === 'true') {
      movies = await enrichMoviesWithPreviews(strapi, movies);
    }

    return { data: movies, meta };
  },

  // Override findOne to populate relations and apply site-setting price
  async findOne(ctx) {
    ctx.query = {
      ...ctx.query,
      populate: ['poster', 'backdrop', 'video'],
    };

    const response = await super.findOne(ctx);
    const { includePreviews } = ctx.query;

    // Apply site-setting default price to single movie
    if (response?.data) {
      const defaults = await getSiteDefaultPrices(strapi);
      const m = response.data.toJSON ? response.data.toJSON() : { ...response.data };
      const defaultPrice = m.type === 'series' ? defaults.seriesPrice : defaults.moviePrice;
      m.priceUGX = defaultPrice;
      response.data = includePreviews === 'true'
        ? await enrichMovieWithPreview(strapi, m)
        : m;
    }

    return response;
  },

  // Most Watched: Return movies sorted by watchCount descending
  async mostWatched(ctx) {
    const limit = Math.min(parseInt(ctx.query.limit) || 12, 50);
    const { luganda } = ctx.query;

    const filters = { isAvailable: true };
    if (luganda === 'true') filters.isLuganda = true;
    else filters.$or = [{ isLuganda: false }, { isLuganda: { $null: true } }];

    // isXXX gating bypassed — see note in `find()`. All catalog items are
    // surfaced regardless of the flag.

    const entries = await strapi.entityService.findMany('api::movie.movie', {
      filters,
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

  // List bulk-upload drafts (admin only). A draft is a movie that was
  // uploaded via the bulk uploader but hasn't had TMDB metadata attached
  // yet — i.e. tmdbId is null AND posterUrl is empty AND isAvailable=false.
  // This endpoint exists so the bulk upload page doesn't have to fight
  // with the public /movies listing's role/permission/draft-publish logic.
  async bulkDrafts(ctx) {
    const requester = ctx.state?.user;
    if (!requester) return ctx.unauthorized('Login required');

    let roleType = requester.role?.type || requester.role?.name;
    if (!roleType) {
      try {
        const fresh = await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          requester.id,
          { populate: ['role'] }
        );
        roleType = fresh?.role?.type || fresh?.role?.name;
      } catch {}
    }
    const isAdmin = roleType === 'admin' || roleType === 'Admin';
    if (!isAdmin) return ctx.forbidden('Admin only');

    const entries = await strapi.entityService.findMany('api::movie.movie', {
      filters: {
        $and: [
          { isAvailable: false },
          { $or: [{ tmdbId: { $null: true } }, { tmdbId: 0 }] },
          { $or: [{ posterUrl: { $null: true } }, { posterUrl: '' }] },
        ],
      },
      sort: [{ createdAt: 'desc' }],
      populate: ['poster', 'backdrop'],
      limit: 1000,
    });

    return { data: entries };
  },

  // Create a Bunny Stream video record and return TUS upload credentials so
  // the admin browser can stream the file directly to Bunny (bypasses Railway
  // bandwidth). Bunny then auto-transcodes the upload into an HLS ABR ladder.
  async bunnyCreateUpload(ctx) {
    const requester = ctx.state?.user;
    if (!requester) return ctx.unauthorized('Login required');

    let roleType = requester.role?.type || requester.role?.name;
    if (!roleType) {
      try {
        const fresh = await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          requester.id,
          { populate: ['role'] }
        );
        roleType = fresh?.role?.type || fresh?.role?.name;
      } catch {}
    }
    const isAdmin = roleType === 'admin' || roleType === 'Admin';
    if (!isAdmin) return ctx.forbidden('Admin only');

    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
    const apiKey = process.env.BUNNY_STREAM_API_KEY;
    const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;
    if (!libraryId || !apiKey) {
      return ctx.internalServerError('Bunny Stream not configured');
    }

    const title = (ctx.request.body?.title || 'Untitled').toString().slice(0, 200);

    // 1) Create the video record on Bunny
    let createRes;
    try {
      createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
          AccessKey: apiKey,
        },
        body: JSON.stringify({ title }),
      });
    } catch (err) {
      strapi.log.error('Bunny create video failed', err);
      return ctx.internalServerError('Failed to reach Bunny Stream');
    }
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      strapi.log.error('Bunny create video bad status', createRes.status, text);
      return ctx.internalServerError('Bunny Stream rejected create');
    }
    const created = await createRes.json();
    const videoId = created?.guid;
    if (!videoId) return ctx.internalServerError('Bunny did not return videoId');

    // 2) Build TUS authorization signature for direct browser upload
    const crypto = require('crypto');
    const expirationTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24h
    const signature = crypto
      .createHash('sha256')
      .update(`${libraryId}${apiKey}${expirationTime}${videoId}`)
      .digest('hex');

    return {
      videoId,
      libraryId: String(libraryId),
      signature,
      expirationTime,
      cdnHostname,
    };
  },

  // Check Bunny Stream encoding progress for a videoId. Used by the admin
  // UI to show "Still transcoding (45%)" or "Ready to publish".
  async bunnyEncodeStatus(ctx) {
    const requester = ctx.state?.user;
    if (!requester) return ctx.unauthorized('Login required');

    let roleType = requester.role?.type || requester.role?.name;
    if (!roleType) {
      try {
        const fresh = await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          requester.id,
          { populate: ['role'] }
        );
        roleType = fresh?.role?.type || fresh?.role?.name;
      } catch {}
    }
    const isAdmin = roleType === 'admin' || roleType === 'Admin';
    if (!isAdmin) return ctx.forbidden('Admin only');

    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
    const apiKey = process.env.BUNNY_STREAM_API_KEY;
    if (!libraryId || !apiKey) {
      return ctx.internalServerError('Bunny Stream not configured');
    }

    const videoId = (ctx.params?.videoId || '').toString().trim();
    if (!videoId) return ctx.badRequest('videoId required');

    try {
      const res = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
        { headers: { AccessKey: apiKey, accept: 'application/json' } }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return ctx.send({ ok: false, httpStatus: res.status, error: text }, 200);
      }
      const info = await res.json();
      const encState = Number(info.status);
      return {
        ok: true,
        videoId,
        encodeState: encState, // 0..6 — see Bunny docs
        isFinished: encState === 4,
        isErrored: encState === 5 || encState === 6,
        encodeProgress: Number(info.encodeProgress) || 0,
        length: Number(info.length) || 0,
        title: info.title || '',
      };
    } catch (err) {
      strapi.log.error('Bunny status check failed', err);
      return ctx.internalServerError('Failed to query Bunny');
    }
  },
}));
