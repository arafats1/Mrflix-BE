'use strict';

const BLOCKED_ORIGIN = 'https://mrflix-be-production.up.railway.app';

// Shared catalog content that browsers may reuse briefly. Personal data
// (purchases, subscriptions, streams, chats, profiles, settings) is not listed
// and stays uncacheable.
const BROWSER_CACHEABLE = /^\/api\/(movies|products|marketplace-ads|books|cars|stories|musics|education-subjects|education-courses)(\/|$)/;
// A seller's own listings change on every save; a cached copy shows a
// published item as the draft it was a minute ago.
const NEVER_BROWSER_CACHED = /^\/api\/products\/(mine|seller-catalog)(\/|$)/;

// Reuse for 60s with no request at all, then show the stored copy for up to
// 10 minutes while the browser fetches a fresh one in the background.
const BROWSER_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=600';

/**
 * Strapi's public URL is still the Railway host, so visiting the custom
 * domain at "/" is redirected to that blocked host. Keep the visitor on the
 * host they actually opened.
 *
 * API responses must not be stored by a CDN: one that ignores query strings
 * would serve page 1 for every product page. Catalog GETs are cached `private`
 * (only in the visitor's own browser, keyed by the full URL) and vary on
 * Authorization, because admins, sellers and guests get different results.
 * Everything else under /api is `no-store`. A handler can opt in by setting a
 * `public` Cache-Control itself, which is only safe for URLs whose response
 * doesn't depend on the query string.
 */
module.exports = () => async (ctx, next) => {
  await next();

  const explicitlyPublic = String(ctx.response.get('Cache-Control') || '').startsWith('public');
  if (ctx.path.startsWith('/api/') && !explicitlyPublic) {
    const cacheable = ctx.method === 'GET' && ctx.status === 200 && BROWSER_CACHEABLE.test(ctx.path)
      && !NEVER_BROWSER_CACHED.test(ctx.path);
    if (cacheable) {
      ctx.set('Cache-Control', BROWSER_CACHE_CONTROL);
      ctx.vary('Authorization');
    } else {
      ctx.set('Cache-Control', 'private, no-store');
    }
  }

  const location = ctx.response.get('Location');
  if (!location || !location.startsWith(BLOCKED_ORIGIN)) return;

  const forwardedHost = String(ctx.get('x-forwarded-host') || ctx.host || '').split(',')[0].trim();
  if (!forwardedHost || forwardedHost.includes('up.railway.app')) return;

  const proto = String(ctx.get('x-forwarded-proto') || ctx.protocol || 'https').split(',')[0].trim();
  ctx.set('Location', `${proto}://${forwardedHost}${location.slice(BLOCKED_ORIGIN.length)}`);
};
