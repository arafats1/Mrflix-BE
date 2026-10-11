'use strict';

const BLOCKED_ORIGIN = 'https://mrflix-be-production.up.railway.app';

/**
 * Strapi's public URL is still the Railway host, so visiting the custom
 * domain at "/" is redirected to that blocked host. Keep the visitor on the
 * host they actually opened. API responses must not be cached: a CDN that
 * ignores query strings otherwise serves page 1 for every product page.
 */
module.exports = () => async (ctx, next) => {
  await next();

  if (ctx.path.startsWith('/api/')) {
    ctx.set('Cache-Control', 'private, no-store');
  }

  const location = ctx.response.get('Location');
  if (!location || !location.startsWith(BLOCKED_ORIGIN)) return;

  const forwardedHost = String(ctx.get('x-forwarded-host') || ctx.host || '').split(',')[0].trim();
  if (!forwardedHost || forwardedHost.includes('up.railway.app')) return;

  const proto = String(ctx.get('x-forwarded-proto') || ctx.protocol || 'https').split(',')[0].trim();
  ctx.set('Location', `${proto}://${forwardedHost}${location.slice(BLOCKED_ORIGIN.length)}`);
};
