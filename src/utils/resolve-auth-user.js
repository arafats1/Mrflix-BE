'use strict';

/**
 * Resolve the logged-in user for custom routes that use `auth: false`.
 * Strapi's users-permissions policy returns 403 on production when route
 * permissions are missing, so marketplace/seller endpoints verify JWT here.
 */
async function resolveAuthUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
    });
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const payload = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!payload?.id) return null;

    return strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: payload.id },
    });
  } catch {
    return null;
  }
}

module.exports = { resolveAuthUser };
