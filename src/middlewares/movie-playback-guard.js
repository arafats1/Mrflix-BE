'use strict';

const {
  isMovieRecord,
  movieHasPlayable,
  getMovieEntitlements,
  accessForMovie,
  restrictMovie,
} = require('../utils/movie-access');

/**
 * Never hand out playable video links for a movie the requester has not paid
 * for (purchase, subscription, free title or admin).
 *
 * Runs on every /api response, so it covers /movies as well as anything that
 * embeds movie records (watchlists, purchases, populate=movie on other
 * types). Before this, the API returned every movie's video URLs to anyone,
 * and only the website's "Rent to Watch" screen stood in the way.
 */

// Callers authenticated another way, who need the real catalogue.
const EXEMPT_PATHS = [
  /^\/api\/movies\/export(\/|$)/, // export API key holders (partner integrations)
  /^\/api\/movie-playback(\/|$)/, // streams video bytes, no JSON body
];

const MAX_DEPTH = 12;

function collectMovies(node, found, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) collectMovies(item, found, depth + 1);
    return;
  }
  if (isMovieRecord(node) && movieHasPlayable(node)) found.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectMovies(value, found, depth + 1);
  }
}

async function resolveUser(ctx, strapi) {
  if (ctx.state?.user?.id) return ctx.state.user;
  // Routes declared with `auth: false` never set ctx.state.user, even when
  // the caller sent a valid token. Read it ourselves so paying users still
  // get their links from those routes.
  const header = ctx.request?.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  try {
    const payload = await strapi.plugin('users-permissions').service('jwt').verify(match[1]);
    if (!payload?.id) return null;
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: payload.id },
      populate: ['role'],
    });
    return user && !user.blocked ? user : null;
  } catch {
    return null;
  }
}

module.exports = (_config, { strapi }) => async (ctx, next) => {
  await next();

  if (!ctx.path?.startsWith('/api/')) return;
  if (EXEMPT_PATHS.some((pattern) => pattern.test(ctx.path))) return;
  const body = ctx.body;
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body) || typeof body.pipe === 'function') return;

  const probe = [];
  collectMovies(body, probe);
  if (probe.length === 0) return;

  let entitlements;
  try {
    entitlements = await getMovieEntitlements(strapi, await resolveUser(ctx, strapi));
  } catch (err) {
    // Fail closed: if we cannot tell, nobody gets links in this response.
    strapi.log.error(`[movie-playback-guard] entitlement lookup failed: ${err.message}`);
    entitlements = { all: false, free: new Set(), full: new Set(), seasons: new Map() };
  }
  if (entitlements.all) return;

  // Work on a copy: controllers may return objects they also keep in memory.
  const copy = JSON.parse(JSON.stringify(body));
  const movies = [];
  collectMovies(copy, movies);
  for (const movie of movies) restrictMovie(movie, accessForMovie(entitlements, movie));
  ctx.body = copy;
};
