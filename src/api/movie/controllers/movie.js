'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const http = require('node:http');
const https = require('node:https');

const ADULT_SEARCH_TERMS = /(^|\b)(adult|18\+|18\s*plus|mature|sex|erotic|explicit)(\b|$)/i;
const ANIMATION_GENRE_RE = /animation|animated|anime|cartoon/i;

function collectGenreContainsTerms(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  const genreContains = node.genres && typeof node.genres === 'object' ? node.genres.$containsi : null;
  if (genreContains) acc.push(String(genreContains));
  if (Array.isArray(node.$or)) node.$or.forEach((clause) => collectGenreContainsTerms(clause, acc));
  if (Array.isArray(node.$and)) node.$and.forEach((clause) => collectGenreContainsTerms(clause, acc));
  return acc;
}

function isAnimationGenreQuery(query = {}) {
  return collectGenreContainsTerms(query.filters || {}).some((term) => ANIMATION_GENRE_RE.test(term));
}

function hasDocumentIdFilter(query = {}) {
  const filters = query.filters || {};
  return Boolean(filters.documentId || filters.id);
}
const TMDB_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_MOVIE_SERVER_BASE_URL = 'https://41.191.79.53:8085/MOVIES/';
const DEFAULT_MOVIE_SERVER_TIMEOUT_MS = 45000;
const MOVIE_SERVER_VIDEO_EXT_RE = /\.(mp4|mkv|mov|avi|webm|m4v)$/i;
const MOVIE_SERVER_ANCHOR_RE = /<a\s+href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;

function decodeHtmlEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripTags(value = '') {
  return value.replace(/<[^>]*>/g, '');
}

function ensureTrailingSlash(value = '') {
  if (!value) return '/';
  return value.endsWith('/') ? value : `${value}/`;
}

function getMovieServerConfig() {
  const baseUrl = (process.env.MOVIE_SERVER_BASE_URL || DEFAULT_MOVIE_SERVER_BASE_URL).trim();
  const parsedTimeout = Number.parseInt(process.env.MOVIE_SERVER_REQUEST_TIMEOUT_MS || '', 10);
  return {
    baseUrl: ensureTrailingSlash(baseUrl),
    username: (process.env.MOVIE_SERVER_USERNAME || '').trim(),
    password: process.env.MOVIE_SERVER_PASSWORD || '',
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_MOVIE_SERVER_TIMEOUT_MS,
  };
}

function getMovieServerBasePath() {
  const { baseUrl } = getMovieServerConfig();
  return ensureTrailingSlash(new URL(baseUrl).pathname || '/');
}

function normalizeMovieServerPath(requestedPath) {
  const basePath = getMovieServerBasePath();
  if (!requestedPath) return basePath;

  let candidate = String(requestedPath).trim();
  if (!candidate) return basePath;
  if (!candidate.startsWith('/')) candidate = `${basePath}${candidate}`;

  const normalized = ensureTrailingSlash(new URL(candidate, 'https://movie-server.local').pathname);
  return normalized.startsWith(basePath) ? normalized : basePath;
}

function getMovieServerParentPath(currentPath) {
  const basePath = getMovieServerBasePath();
  if (currentPath === basePath) return null;

  const segments = currentPath.slice(basePath.length).split('/').filter(Boolean);
  if (!segments.length) return null;
  if (segments.length === 1) return basePath;
  return `${basePath}${segments.slice(0, -1).join('/')}/`;
}

function buildMovieServerBreadcrumbs(currentPath) {
  const basePath = getMovieServerBasePath();
  const baseSegments = basePath.split('/').filter(Boolean);
  const breadcrumbs = [
    {
      name: decodeURIComponent(baseSegments[baseSegments.length - 1] || 'Root'),
      path: basePath,
    },
  ];

  let cursor = basePath;
  const segments = currentPath.slice(basePath.length).split('/').filter(Boolean);
  for (const segment of segments) {
    cursor = `${cursor}${segment}/`;
    breadcrumbs.push({
      name: decodeURIComponent(segment),
      path: cursor,
    });
  }

  return breadcrumbs;
}

async function fetchMovieServerIndexHtml(targetUrl, username, password) {
  if (!username || !password) {
    throw new Error('Movie server credentials are not configured');
  }

  const { timeoutMs } = getMovieServerConfig();

  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'text/html,application/xhtml+xml',
        },
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 500, body });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Movie server request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseMovieServerIndex(html, currentUrl, currentPath) {
  const basePath = getMovieServerBasePath();
  const directories = [];
  const files = [];
  const seenDirectories = new Set();
  const seenFiles = new Set();

  for (const match of html.matchAll(MOVIE_SERVER_ANCHOR_RE)) {
    const href = match[2]?.trim();
    if (!href || href === '../' || href.startsWith('#') || href.startsWith('?')) continue;

    let resolved;
    try {
      resolved = new URL(href, currentUrl);
    } catch {
      continue;
    }

    const pathname = resolved.pathname || '';
    if (!pathname.startsWith(basePath)) continue;

    const labelText = decodeHtmlEntities(stripTags(match[3] || '')).trim().replace(/\/$/, '');
    const fallbackName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    const name = labelText || fallbackName;
    if (!name || name === '..' || name.startsWith('.')) continue;

    if (pathname.endsWith('/')) {
      const directoryPath = ensureTrailingSlash(pathname);
      if (directoryPath === currentPath || seenDirectories.has(directoryPath)) continue;
      seenDirectories.add(directoryPath);
      directories.push({ name, path: directoryPath });
      continue;
    }

    if (!MOVIE_SERVER_VIDEO_EXT_RE.test(pathname) || seenFiles.has(pathname)) continue;
    seenFiles.add(pathname);

    const lastDot = name.lastIndexOf('.');
    files.push({
      name,
      path: pathname,
      url: resolved.toString(),
      extension: (lastDot >= 0 ? name.slice(lastDot + 1) : '').toLowerCase(),
      folder: decodeURIComponent(currentPath.slice(basePath.length).replace(/\/$/, '')),
    });
  }

  directories.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  files.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

  return { directories, files };
}

function getBaseUrl(ctx) {
  const envUrl = (process.env.PUBLIC_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  const origin = ctx.request?.origin || '';
  return origin.replace(/\/$/, '');
}

function toAbsoluteUrl(url, baseUrl) {
  if (!url || typeof url !== 'string') return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return url;
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

function getMovieServerUrlInfo(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const targetUrl = new URL(url);
    const { baseUrl } = getMovieServerConfig();
    const movieServerUrl = new URL(baseUrl);
    const basePath = ensureTrailingSlash(movieServerUrl.pathname || '/');
    const targetPath = targetUrl.pathname || '/';
    if (targetUrl.origin !== movieServerUrl.origin) return null;
    if (!targetPath.startsWith(basePath)) return null;
    return { url: targetUrl, requestPath: `${targetPath}${targetUrl.search || ''}` };
  } catch {
    return null;
  }
}

function buildMoviePlaybackUrl(url, baseUrl) {
  const absoluteUrl = toAbsoluteUrl(url, baseUrl);
  if (!absoluteUrl) return null;
  const movieServerInfo = getMovieServerUrlInfo(absoluteUrl);
  if (!movieServerInfo) return absoluteUrl;
  return `${baseUrl}/api/movie-playback?path=${encodeURIComponent(movieServerInfo.requestPath)}`;
}

function getMediaUrl(media, baseUrl) {
  if (!media) return null;
  const rawUrl = media.url || media?.formats?.large?.url || media?.formats?.medium?.url || media?.formats?.small?.url || media?.formats?.thumbnail?.url;
  return toAbsoluteUrl(rawUrl, baseUrl);
}

function mapMediaAsset(media, baseUrl) {
  if (!media) return null;
  return {
    id: media.id || null,
    documentId: media.documentId || null,
    name: media.name || null,
    alternativeText: media.alternativeText || null,
    caption: media.caption || null,
    width: media.width || null,
    height: media.height || null,
    mime: media.mime || null,
    ext: media.ext || null,
    sizeKB: typeof media.size === 'number' ? media.size : null,
    url: getMediaUrl(media, baseUrl),
  };
}

function buildBunnyPlayback(videoId) {
  const normalizedVideoId = typeof videoId === 'string' ? videoId.trim() : '';
  const cdnHostname = (process.env.BUNNY_STREAM_CDN_HOSTNAME || '').trim();
  const libraryId = (process.env.BUNNY_STREAM_LIBRARY_ID || '').trim();
  if (!normalizedVideoId) return null;

  return {
    videoId: normalizedVideoId,
    hlsUrl: cdnHostname ? `https://${cdnHostname}/${normalizedVideoId}/playlist.m3u8` : null,
    iframeUrl: libraryId ? `https://iframe.mediadelivery.net/embed/${libraryId}/${normalizedVideoId}?autoplay=false&preload=true&responsive=true` : null,
  };
}

function mapEpisodeList(episodes, baseUrl) {
  if (!Array.isArray(episodes)) return [];

  return episodes.map((episode, index) => {
    const bunnyPlayback = buildBunnyPlayback(episode?.bunnyVideoId);
    return {
      id: episode?.id || null,
      title: episode?.title || episode?.name || `Episode ${index + 1}`,
      overview: episode?.overview || episode?.description || null,
      seasonNumber: episode?.seasonNumber ?? episode?.season ?? null,
      episodeNumber: episode?.episodeNumber ?? episode?.number ?? index + 1,
      runtime: episode?.runtime ?? null,
      thumbnailUrl: toAbsoluteUrl(episode?.thumbnailUrl || episode?.posterUrl || null, baseUrl),
      videoUrl: toAbsoluteUrl(episode?.videoUrl || null, baseUrl),
      videoUrl720: toAbsoluteUrl(episode?.videoUrl720 || null, baseUrl),
      videoUrl480: toAbsoluteUrl(episode?.videoUrl480 || null, baseUrl),
      subtitleUrl: toAbsoluteUrl(episode?.subtitleUrl || null, baseUrl),
      bunnyVideoId: episode?.bunnyVideoId || null,
      playback: bunnyPlayback,
      raw: episode,
    };
  });
}

function mapCatalogMovie(movie, baseUrl) {
  const posterAsset = mapMediaAsset(movie.poster, baseUrl);
  const backdropAsset = mapMediaAsset(movie.backdrop, baseUrl);
  const videoAsset = mapMediaAsset(movie.video, baseUrl);
  const playback = buildBunnyPlayback(movie.bunnyVideoId);
  const lugandaPlayback = buildBunnyPlayback(movie.lugandaBunnyVideoId);

  return {
    id: movie.documentId || movie.id,
    strapiId: movie.id,
    documentId: movie.documentId || null,
    slug: movie.slug || null,
    title: movie.title,
    overview: movie.overview || null,
    type: movie.type,
    tmdbId: movie.tmdbId || null,
    releaseDate: movie.releaseDate || null,
    rating: movie.rating || null,
    genres: Array.isArray(movie.genres) ? movie.genres : (movie.genres || []),
    seasons: movie.seasons || null,
    countryOfOrigin: movie.countryOfOrigin || null,
    isLuganda: Boolean(movie.isLuganda),
    translatedLanguage: movie.translatedLanguage || (movie.isLuganda ? 'Luganda' : null),
    vjName: movie.vjName || null,
    religiousCategory: movie.religiousCategory || null,
    posterUrl: toAbsoluteUrl(movie.posterUrl, baseUrl) || posterAsset?.url,
    backdropUrl: toAbsoluteUrl(movie.backdropUrl, baseUrl) || backdropAsset?.url,
    trailerUrl: toAbsoluteUrl(movie.trailerUrl, baseUrl),
    subtitleUrl: toAbsoluteUrl(movie.subtitleUrl, baseUrl),
    videoUrl: toAbsoluteUrl(movie.videoUrl, baseUrl) || videoAsset?.url,
    videoUrl720: toAbsoluteUrl(movie.videoUrl720, baseUrl),
    videoUrl480: toAbsoluteUrl(movie.videoUrl480, baseUrl),
    bunnyVideoId: movie.bunnyVideoId || null,
    isAvailable: movie.isAvailable !== false,
    isFeatured: Boolean(movie.isFeatured),
    isTrending: Boolean(movie.isTrending),
    isAdult: Boolean(movie.isAdult),
    isXXX: Boolean(movie.isXXX),
    adultsOnly: Boolean(movie.adultsOnly),
    isShortClip: Boolean(movie.isShortClip),
    minAge: Number(movie.minAge || 0) || 0,
    embedUrl: toAbsoluteUrl(movie.embedUrl, baseUrl),
    teaserUrl: toAbsoluteUrl(movie.teaserUrl, baseUrl),
    teaserEmbedUrl: toAbsoluteUrl(movie.teaserEmbedUrl, baseUrl),
    trailerEmbedUrl: toAbsoluteUrl(movie.trailerEmbedUrl, baseUrl),
    lugandaVideoUrl: toAbsoluteUrl(movie.lugandaVideoUrl, baseUrl),
    lugandaVideoUrl720: toAbsoluteUrl(movie.lugandaVideoUrl720, baseUrl),
    lugandaVideoUrl480: toAbsoluteUrl(movie.lugandaVideoUrl480, baseUrl),
    lugandaBunnyVideoId: movie.lugandaBunnyVideoId || null,
    playback,
    translatedAudio: {
      language: movie.translatedLanguage || (movie.isLuganda ? 'Luganda' : null),
      videoUrl: toAbsoluteUrl(movie.lugandaVideoUrl, baseUrl),
      videoUrl720: toAbsoluteUrl(movie.lugandaVideoUrl720, baseUrl),
      videoUrl480: toAbsoluteUrl(movie.lugandaVideoUrl480, baseUrl),
      bunnyVideoId: movie.lugandaBunnyVideoId || null,
      playback: lugandaPlayback,
    },
    assets: {
      poster: posterAsset,
      backdrop: backdropAsset,
      video: videoAsset,
    },
    episodes: mapEpisodeList(movie.episodes, baseUrl),
    translatedEpisodes: mapEpisodeList(movie.lugandaEpisodes, baseUrl),
    createdAt: movie.createdAt || null,
    updatedAt: movie.updatedAt || null,
    publishedAt: movie.publishedAt || null,
  };
}

function getBearerToken(ctx) {
  const header = ctx.request?.headers?.authorization || '';
  return header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
}

async function canUseExportApi(strapi, ctx) {
  const configuredKey = (process.env.MOVIE_EXPORT_API_KEY || '').trim();
  const bearer = getBearerToken(ctx);
  const queryKey = typeof ctx.query?.apiKey === 'string' ? ctx.query.apiKey.trim() : '';
  const suppliedKey = bearer || queryKey;

  if (configuredKey && suppliedKey && suppliedKey === configuredKey) {
    return true;
  }

  if (!bearer) return false;

  try {
    const apiTokenService = strapi.admin?.services?.['api-token'];
    if (!apiTokenService?.hash || !apiTokenService?.getBy) {
      return false;
    }

    const apiToken = await apiTokenService.getBy({
      accessKey: apiTokenService.hash(bearer),
    });

    if (!apiToken) return false;

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      return false;
    }

    if (apiToken.type === 'full-access' || apiToken.type === 'read-only') {
      return true;
    }

    if (apiToken.type === 'custom') {
      const permissions = Array.isArray(apiToken.permissions) ? apiToken.permissions : [];
      return permissions.includes('api::movie.movie.find') || permissions.includes('api::movie.movie.findOne');
    }
  } catch (error) {
    strapi.log.warn(`movie export token check failed: ${error.message}`);
  }

  return false;
}

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
 * Movies and series share the same moviePrice from site settings.
 */
function applyDefaultPrices(movies, defaults) {
  if (!Array.isArray(movies)) return movies;
  const defaultPrice = defaults.moviePrice;
  return movies.map((movie) => {
    const m = movie.toJSON ? movie.toJSON() : { ...movie };
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
    const kidsCatalog = String(ctx.query.kidsCatalog ?? ctx.request?.query?.kidsCatalog ?? '') === 'true';

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
    void includeXXX;

    const filterBlob = JSON.stringify(ctx.query.filters || {});
    const wantsAnimation = /animation|animated|anime|cartoon/i.test(filterBlob);
    // Exclusive Animation is stored as isXXX. Never hide those titles from
    // kids/animation listings — Exclusive page already shows them.
    if (!allowXXX && !kidsCatalog && !wantsAnimation) {
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
      m.priceUGX = defaults.moviePrice;
      const enriched = includePreviews === 'true'
        ? await enrichMovieWithPreview(strapi, m)
        : m;
      response.data = enriched;
    }

    return response;
  },

  async exportCatalog(ctx) {
    if (!(await canUseExportApi(strapi, ctx))) {
      return ctx.forbidden('Invalid or missing export credential. Send either MOVIE_EXPORT_API_KEY or a valid Strapi Content API token in Authorization: Bearer ...');
    }

    const page = Math.max(parseInt(ctx.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(ctx.query.pageSize, 10) || 100, 1), 500);
    const includeUnavailable = ctx.query.includeUnavailable === 'true';
    const includeDrafts = ctx.query.includeDrafts === 'true';
    const includeAdult = ctx.query.includeAdult === 'true';
    const updatedSince = typeof ctx.query.updatedSince === 'string' ? ctx.query.updatedSince.trim() : '';

    const filters = { $and: [] };

    if (!includeUnavailable) {
      filters.$and.push({ isAvailable: true });
    }

    if (!includeDrafts) {
      filters.$and.push({ publishedAt: { $notNull: true } });
    }

    if (!includeAdult) {
      filters.$and.push({ $or: [{ isAdult: false }, { isAdult: { $null: true } }] });
      filters.$and.push({ $or: [{ isXXX: false }, { isXXX: { $null: true } }] });
    }

    if (updatedSince) {
      const parsedDate = new Date(updatedSince);
      if (Number.isNaN(parsedDate.getTime())) {
        return ctx.badRequest('updatedSince must be a valid ISO date');
      }
      filters.$and.push({ updatedAt: { $gte: parsedDate.toISOString() } });
    }

    if (filters.$and.length === 0) {
      delete filters.$and;
    }

    const entryQuery = {
      filters,
      populate: ['poster', 'backdrop', 'video'],
      sort: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      start: (page - 1) * pageSize,
      limit: pageSize,
    };

    if (!includeDrafts) {
      entryQuery.status = 'published';
    }

    const [entries, total] = await Promise.all([
      strapi.documents('api::movie.movie').findMany(entryQuery),
      strapi.db.query('api::movie.movie').count({ where: filters }),
    ]);

    const defaults = await getSiteDefaultPrices(strapi);
    const normalizedEntries = applyDefaultPrices(entries, defaults);
    const baseUrl = getBaseUrl(ctx);

    return {
      data: normalizedEntries.map((movie) => mapCatalogMovie(movie, baseUrl)),
      meta: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
        hasNextPage: page * pageSize < total,
        filters: {
          includeUnavailable,
          includeDrafts,
          includeAdult,
          updatedSince: updatedSince || null,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  },

  async playback(ctx) {
    const requestedPath = typeof ctx.query?.path === 'string' ? ctx.query.path.trim() : '';
    if (!requestedPath) return ctx.badRequest('path query parameter is required');

    const { baseUrl, username, password, timeoutMs } = getMovieServerConfig();
    let candidateUrl;
    try {
      candidateUrl = new URL(requestedPath, baseUrl);
    } catch {
      return ctx.badRequest('Invalid path');
    }
    const movieServerInfo = getMovieServerUrlInfo(candidateUrl.toString());
    if (!movieServerInfo) return ctx.badRequest('Invalid movie server path');

    const requestModule = movieServerInfo.url.protocol === 'http:' ? http : https;
    const upstreamHeaders = { Accept: '*/*' };
    const rangeHeader = ctx.request.headers.range;
    if (rangeHeader) upstreamHeaders.Range = rangeHeader;
    if (username && password) {
      upstreamHeaders.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    await new Promise((resolve, reject) => {
      const req = requestModule.request(
        movieServerInfo.url,
        { method: 'GET', headers: upstreamHeaders, rejectUnauthorized: false, timeout: timeoutMs },
        (upstream) => {
          ctx.status = upstream.statusCode || 500;
          for (const [name, value] of Object.entries(upstream.headers || {})) {
            if (!value || name.toLowerCase() === 'transfer-encoding') continue;
            ctx.set(name, value);
          }
          ctx.respond = false;
          upstream.on('error', reject);
          upstream.pipe(ctx.res);
          upstream.on('end', resolve);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Upstream timeout')));
      req.on('error', reject);
      req.end();
    }).catch((err) => {
      strapi.log.error('Movie playback proxy failed:', err);
      if (!ctx.headerSent) {
        ctx.status = 502;
        ctx.body = { error: 'Could not stream this movie right now.' };
      }
    });
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
  async serverBrowser(ctx) {
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

    const { baseUrl, username, password } = getMovieServerConfig();
    if (!baseUrl || !username || !password) {
      return ctx.internalServerError('Movie server is not configured');
    }

    const currentPath = normalizeMovieServerPath(ctx.query?.path);
    const targetUrl = new URL(currentPath, baseUrl).toString();

    try {
      const response = await fetchMovieServerIndexHtml(targetUrl, username, password);
      if (response.statusCode >= 400) {
        strapi.log.error(`Movie server browser failed with HTTP ${response.statusCode} for ${targetUrl}`);
        return ctx.internalServerError('Could not read the movie server directory listing');
      }

      const { directories, files } = parseMovieServerIndex(response.body, targetUrl, currentPath);

      return {
        data: {
          basePath: getMovieServerBasePath(),
          currentPath,
          parentPath: getMovieServerParentPath(currentPath),
          breadcrumbs: buildMovieServerBreadcrumbs(currentPath),
          directories,
          files,
        },
      };
    } catch (error) {
      strapi.log.error('Movie server browser failed:', error);
      return ctx.internalServerError(error?.message || 'Could not browse the movie server');
    }
  },

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
