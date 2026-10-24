'use strict';

const crypto = require('crypto');
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');

async function requireAdminUser(strapi, ctx) {
  const currentUser = await resolveAuthUser(strapi, ctx);
  if (!currentUser) {
    ctx.unauthorized();
    return null;
  }

  const withRole = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: currentUser.id },
    populate: ['role'],
  });
  const isAdmin = withRole?.role?.type === 'admin' || withRole?.role?.name === 'Admin';
  if (!isAdmin) {
    ctx.forbidden('Admin only');
    return null;
  }
  return withRole;
}

async function createUniqueCode(strapi) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const existing = await strapi.db.query('api::sales-agent.sales-agent').findOne({
      where: { code },
      select: ['id'],
    });
    if (!existing) return code;
  }
  return null;
}

module.exports = {
  async list(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const agents = await strapi.db.query('api::sales-agent.sales-agent').findMany({
      orderBy: { createdAt: 'desc' },
      limit: 200,
    });
    const sellers = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { sellerSalesCode: { $notNull: true } },
      select: ['id', 'fullName', 'username', 'phone', 'sellerSalesCode', 'createdAt', 'providerType'],
      limit: 5000,
    });
    const productLinks = await strapi.db.connection('products_seller_lnk')
      .distinct('user_id')
      .whereNotNull('user_id');
    const sellerIdsWithProducts = new Set((productLinks || []).map((row) => Number(row.user_id)));

    ctx.body = {
      data: (agents || []).map((agent) => {
        const signedSellers = (sellers || [])
          .filter((seller) => seller.sellerSalesCode === agent.code && sellerIdsWithProducts.has(Number(seller.id)))
          .map((seller) => ({
            id: seller.id,
            name: seller.fullName || seller.username || 'Seller',
            phone: seller.phone || '',
            createdAt: seller.createdAt,
          }));
        return {
          id: agent.id,
          agentName: agent.agentName,
          code: agent.code,
          active: agent.active !== false,
          sellerCount: signedSellers.length,
          sellers: signedSellers,
          createdAt: agent.createdAt,
        };
      }),
    };
  },

  async createAgent(ctx) {
    const admin = await requireAdminUser(strapi, ctx);
    if (!admin) return;

    const body = ctx.request.body?.data || ctx.request.body || {};
    const agentName = typeof body.agentName === 'string' ? body.agentName.trim() : '';
    if (agentName.length < 2) return ctx.badRequest('Enter the sales agent name');

    const code = await createUniqueCode(strapi);
    if (!code) return ctx.badRequest('Could not generate a unique code. Try again.');

    const agent = await strapi.db.query('api::sales-agent.sales-agent').create({
      data: { agentName, code, active: true },
    });

    ctx.body = {
      data: {
        id: agent.id,
        agentName: agent.agentName,
        code: agent.code,
        sellerCount: 0,
        sellers: [],
      },
    };
  },
};
