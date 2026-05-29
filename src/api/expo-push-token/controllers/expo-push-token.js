'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::expo-push-token.expo-push-token', ({ strapi }) => ({
  async upsert(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in');

    const token = String((ctx.request.body || {}).token || '').trim();
    if (!token || !token.startsWith('ExponentPushToken')) {
      return ctx.badRequest('Invalid Expo push token');
    }

    const platform = String((ctx.request.body || {}).platform || '').trim() || null;

    const existing = await strapi.entityService.findMany('api::expo-push-token.expo-push-token', {
      filters: { token, user: { id: user.id } },
      limit: 1,
    });

    const data = {
      user: user.id,
      token,
      platform,
      revokedAt: null,
      lastUsedAt: new Date().toISOString(),
    };

    const record = existing?.[0]
      ? await strapi.entityService.update('api::expo-push-token.expo-push-token', existing[0].id, { data })
      : await strapi.entityService.create('api::expo-push-token.expo-push-token', { data });

    ctx.send({ data: { id: record.id, registered: true } });
  },

  async remove(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in');

    const token = String((ctx.request.body || {}).token || '').trim();
    if (!token) return ctx.badRequest('Missing token');

    const records = await strapi.entityService.findMany('api::expo-push-token.expo-push-token', {
      filters: { token, user: { id: user.id }, revokedAt: { $null: true } },
      limit: 20,
    });

    const now = new Date().toISOString();
    await Promise.all(records.map((r) =>
      strapi.entityService.update('api::expo-push-token.expo-push-token', r.id, {
        data: { revokedAt: now },
      })
    ));

    ctx.send({ data: { removed: records.length } });
  },
}));
