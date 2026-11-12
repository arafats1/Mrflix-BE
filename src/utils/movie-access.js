'use strict';

/**
 * Who may play which movie, decided on the server.
 *
 * Mirrors the rules the website's watch page has always used, so nothing
 * changes for paying customers:
 *   - admins: everything
 *   - an active premium subscription or an active exclusive subscription:
 *     everything
 *   - the "free movie of the week" titles: everyone, signed in or not
 *   - a completed purchase:
 *       movie  -> that movie, until `expiresAt` (if set)
 *       series -> the whole series (no seasonNumber) or the purchased
 *                 seasons; free-trial purchases do not unlock series
 */

const PLAYABLE_MOVIE_FIELDS = [
  'videoUrl',
  'videoUrl720',
  'videoUrl480',
  'embedUrl',
  'bunnyVideoId',
  'lugandaVideoUrl',
  'lugandaVideoUrl720',
  'lugandaVideoUrl480',
  'lugandaBunnyVideoId',
  'video',
  'playback',
];

const PLAYABLE_EPISODE_FIELDS = [
  'videoUrl',
  'videoUrl720',
  'videoUrl480',
  'embedUrl',
  'bunnyVideoId',
  'playback',
  'raw',
];

const EPISODE_LIST_FIELDS = ['episodes', 'lugandaEpisodes'];

// Keys that only movie records have (music, stories and provider materials
// also have `videoUrl`, and must not be touched).
const MOVIE_ONLY_KEYS = [
  'tmdbId',
  'bunnyVideoId',
  'lugandaBunnyVideoId',
  'lugandaVideoUrl',
  'lugandaEpisodes',
  'isXXX',
  'vjName',
  'translatedLanguage',
  'isLuganda',
];

function isMovieRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (MOVIE_ONLY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return true;
  return (value.type === 'movie' || value.type === 'series')
    && Object.prototype.hasOwnProperty.call(value, 'posterUrl');
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function episodeHasPlayable(episode) {
  return !!episode && typeof episode === 'object'
    && PLAYABLE_EPISODE_FIELDS.some((field) => hasValue(episode[field]));
}

/** True when this movie record carries anything that can be played. */
function movieHasPlayable(movie) {
  if (PLAYABLE_MOVIE_FIELDS.some((field) => hasValue(movie[field]))) return true;
  return EPISODE_LIST_FIELDS.some((field) => Array.isArray(movie[field]) && movie[field].some(episodeHasPlayable));
}

function episodeSeason(episode) {
  const season = episode?.season ?? episode?.seasonNumber;
  const parsed = Number(season);
  return Number.isFinite(parsed) ? parsed : null;
}

function movieKeys(movie) {
  return [movie?.documentId, movie?.id].filter((key) => key !== undefined && key !== null).map(String);
}

async function getFreeMovieIds(strapi) {
  try {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (!settings?.freeMovieOfWeekEnabled) return new Set();
    const ids = Array.isArray(settings.freeWatchMovieIds) && settings.freeWatchMovieIds.length > 0
      ? settings.freeWatchMovieIds.filter(Boolean)
      : (settings.freeMovieOfWeekId ? [settings.freeMovieOfWeekId] : []);
    return new Set(ids.map(String));
  } catch (err) {
    strapi.log.warn(`[movie-access] free movie lookup failed: ${err.message}`);
    return new Set();
  }
}

async function hasActive(strapi, uid, userId, now) {
  const rows = await strapi.db.query(uid).findMany({
    where: { subscriber: { id: userId }, status: 'active', endDate: { $gte: now } },
    select: ['id'],
    limit: 1,
  });
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Everything a user (or an anonymous visitor, when `user` is null) may play.
 * Returns { all, free:Set, full:Set, seasons:Map<key, Set<number>> }, keyed by
 * movie documentId and row id.
 */
async function getMovieEntitlements(strapi, user) {
  const entitlements = { all: false, free: await getFreeMovieIds(strapi), full: new Set(), seasons: new Map() };
  if (!user?.id) return entitlements;

  let roleType = user.role?.type || user.role?.name;
  if (!roleType) {
    try {
      const fresh = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        populate: ['role'],
      });
      roleType = fresh?.role?.type || fresh?.role?.name;
    } catch {
      // treated as a regular user
    }
  }
  if (roleType === 'admin' || roleType === 'Admin') {
    entitlements.all = true;
    return entitlements;
  }

  const now = new Date().toISOString();
  const [premium, exclusive] = await Promise.all([
    hasActive(strapi, 'api::subscription.subscription', user.id, now).catch(() => false),
    hasActive(strapi, 'api::exclusive-subscription.exclusive-subscription', user.id, now).catch(() => false),
  ]);
  if (premium || exclusive) {
    entitlements.all = true;
    return entitlements;
  }

  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { buyer: { id: user.id }, status: 'completed', movie: { id: { $notNull: true } } },
    select: ['id', 'seasonNumber', 'expiresAt', 'paymentMethod'],
    populate: { movie: { select: ['id', 'documentId', 'type'] } },
  }).catch((err) => {
    strapi.log.warn(`[movie-access] purchase lookup failed: ${err.message}`);
    return [];
  });

  const nowMs = Date.now();
  for (const purchase of purchases) {
    const movie = purchase.movie;
    if (!movie) continue;
    const keys = movieKeys(movie);
    const season = Number(purchase.seasonNumber);
    const isSeasonPurchase = purchase.seasonNumber !== null && purchase.seasonNumber !== undefined && Number.isFinite(season);

    if (movie.type === 'series') {
      if (purchase.paymentMethod === 'free_trial') continue;
      if (isSeasonPurchase) {
        for (const key of keys) {
          if (!entitlements.seasons.has(key)) entitlements.seasons.set(key, new Set());
          entitlements.seasons.get(key).add(season);
        }
      } else {
        keys.forEach((key) => entitlements.full.add(key));
      }
      continue;
    }

    if (purchase.expiresAt && new Date(purchase.expiresAt).getTime() <= nowMs) continue;
    keys.forEach((key) => entitlements.full.add(key));
  }

  return entitlements;
}

/** 'full', 'seasons' (with the set) or 'none' for one movie record. */
function accessForMovie(entitlements, movie) {
  if (entitlements.all) return { level: 'full' };
  const keys = movieKeys(movie);
  if (keys.some((key) => entitlements.free.has(key) || entitlements.full.has(key))) return { level: 'full' };
  const seasons = new Set();
  for (const key of keys) {
    for (const season of entitlements.seasons.get(key) || []) seasons.add(season);
  }
  return seasons.size > 0 ? { level: 'seasons', seasons } : { level: 'none' };
}

function stripEpisode(episode) {
  if (!episode || typeof episode !== 'object') return episode;
  const copy = { ...episode };
  for (const field of PLAYABLE_EPISODE_FIELDS) delete copy[field];
  copy.playbackLocked = true;
  return copy;
}

/**
 * Remove what the viewer may not play from one movie record (in place on a
 * copy the caller owns). Titles, artwork, trailers and episode lists stay so
 * the page can still offer Rent / Subscribe.
 */
function restrictMovie(movie, access) {
  if (access.level === 'full') return movie;

  for (const field of PLAYABLE_MOVIE_FIELDS) delete movie[field];
  for (const listField of EPISODE_LIST_FIELDS) {
    if (!Array.isArray(movie[listField])) continue;
    movie[listField] = movie[listField].map((episode) => (
      access.level === 'seasons' && access.seasons.has(episodeSeason(episode))
        ? episode
        : stripEpisode(episode)
    ));
  }
  movie.playbackLocked = access.level === 'none';
  if (access.level === 'seasons') movie.playableSeasons = Array.from(access.seasons).sort((a, b) => a - b);
  return movie;
}

module.exports = {
  PLAYABLE_MOVIE_FIELDS,
  isMovieRecord,
  movieHasPlayable,
  getMovieEntitlements,
  accessForMovie,
  restrictMovie,
};
