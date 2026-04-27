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
    const { type, featured, available, q, luganda, includeXXX, includePreviews } = ctx.query;

    const filters = {};
    if (type) filters.type = type;
    if (featured === 'true') filters.isFeatured = true;
    if (available !== 'false') filters.isAvailable = true;
    if (luganda === 'true') filters.isLuganda = true;
    else if (luganda === 'all') { /* no filter — show both */ }
    else filters.$or = [{ isLuganda: false }, { isLuganda: { $null: true } }];

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

    // Exclude XXX content unless explicitly requested (admin use)
    if (includeXXX !== 'true') {
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

    // Exclude XXX content from most watched
    filters.$and = [{ $or: [{ isXXX: false }, { isXXX: { $null: true } }] }];

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
}));
