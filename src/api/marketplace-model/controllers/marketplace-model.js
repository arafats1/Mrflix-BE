'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

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

async function resolveUserWithRole(strapi, ctx) {
  if (ctx.state.user?.id) return getUserWithRole(strapi, ctx.state.user.id);

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  try {
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    return getUserWithRole(strapi, id);
  } catch (_) {
    return null;
  }
}

async function assertAdmin(ctx, strapi) {
  const user = await resolveUserWithRole(strapi, ctx);
  if (!user) {
    ctx.unauthorized('You must be logged in');
    return false;
  }
  if (!isAdminUser(user)) {
    ctx.forbidden('Only admins can manage marketplace model images');
    return false;
  }
  return true;
}

function normalizeModel(model) {
  if (!model) return null;
  return {
    id: model.documentId || String(model.id),
    strapiId: model.id,
    name: model.name || '',
    url: model.imageUrl || '',
    imageUrl: model.imageUrl || '',
    status: model.status || 'active',
    createdAt: model.createdAt || null,
    updatedAt: model.updatedAt || null,
  };
}

module.exports = createCoreController('api::marketplace-model.marketplace-model', ({ strapi }) => ({
  async adminList(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const models = await strapi.documents('api::marketplace-model.marketplace-model').findMany({
      filters: { status: 'active' },
      sort: [{ createdAt: 'desc' }],
      limit: 300,
    });

    return { data: (models || []).map(normalizeModel).filter(Boolean) };
  },

  async adminCreate(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const input = ctx.request.body?.data || ctx.request.body || {};
    const name = String(input.name || 'Model image').trim();
    const imageUrl = String(input.imageUrl || input.url || '').trim();
    if (!imageUrl) return ctx.badRequest('Model image URL is required');

    const created = await strapi.documents('api::marketplace-model.marketplace-model').create({
      data: {
        name,
        imageUrl,
        status: input.status === 'archived' ? 'archived' : 'active',
      },
    });

    return { data: normalizeModel(created) };
  },

  async adminDelete(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const documentId = String(ctx.params.id || '').trim();
    if (!documentId) return ctx.badRequest('Missing model id');

    await strapi.documents('api::marketplace-model.marketplace-model').update({
      documentId,
      data: { status: 'archived' },
    });

    return { data: { success: true } };
  },
}));