'use strict';

/**
 * Airtel portal probes callback URLs with HEAD.
 * Strapi route configs do not support HEAD, so answer those probes here.
 */
module.exports = (config, { strapi }) => {
  const CALLBACK_PATHS = new Set([
    '/api/airtel/callback',
    '/api/airtel/collections/callback',
  ]);

  return async (ctx, next) => {
    if (ctx.method === 'HEAD' && CALLBACK_PATHS.has(ctx.path)) {
      ctx.status = 200;
      ctx.body = '';
      return;
    }

    await next();
  };
};
