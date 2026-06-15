'use strict';

function isAdminUser(user) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || user?.isApiTokenAdmin === true;
}

async function getUserWithRole(strapi, userId) {
  if (!userId) return null;
  return strapi.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
}

async function resolveApiTokenAdmin(strapi, token) {
  if (!token) return null;
  try {
    const apiTokenService = strapi.service('admin::api-token');
    if (!apiTokenService?.hash) return null;
    const accessKey = apiTokenService.hash(token);
    const tokenRow = await strapi.db.query('admin::api-token').findOne({ where: { accessKey } });
    if (tokenRow && tokenRow.type === 'full-access') {
      return { isApiTokenAdmin: true };
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function resolveUserWithRole(strapi, ctx) {
  if (ctx.state.user?.id) {
    return getUserWithRole(strapi, ctx.state.user.id);
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  try {
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    const user = await getUserWithRole(strapi, id);
    if (user) return user;
  } catch (_) {
    // Not a users-permissions JWT — fall through to API token check.
  }

  return resolveApiTokenAdmin(strapi, token);
}

async function assertAdmin(ctx, strapi) {
  const user = await resolveUserWithRole(strapi, ctx);

  if (!user) {
    ctx.unauthorized('You must be logged in');
    return null;
  }

  if (!isAdminUser(user)) {
    ctx.forbidden('Admin access required');
    return null;
  }

  return user;
}

module.exports = {
  assertAdmin,
};
