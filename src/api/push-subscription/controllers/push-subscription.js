'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getPublicVapidKey, isPushConfigured } = require('../../../utils/push-notifications');
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');

async function resolveUser(strapi, ctx) {
  const user = await resolveAuthUser(strapi, ctx);
  if (!user) return null;
  ctx.state.user = user;
  return user;
}

function normalizeSubscription(input) {
  const source = input?.subscription || input || {};
  const endpoint = String(source.endpoint || '').trim();
  const keys = source.keys || {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();

  if (!endpoint || !p256dh || !auth) return null;

  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: source.expirationTime == null ? null : String(source.expirationTime),
  };
}

module.exports = createCoreController('api::push-subscription.push-subscription', ({ strapi }) => ({
  async publicKey(ctx) {
    ctx.send({
      data: {
        publicKey: getPublicVapidKey(),
        configured: isPushConfigured(),
      },
    });
  },

  async upsert(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    if (!isPushConfigured()) {
      return ctx.badRequest('Push notifications are not configured on the server');
    }

    const normalized = normalizeSubscription(ctx.request.body || {});
    if (!normalized) return ctx.badRequest('Invalid push subscription');

    const userAgent = ctx.request.headers['user-agent'] || '';
    const existing = await strapi.entityService.findMany('api::push-subscription.push-subscription', {
      filters: {
        endpoint: normalized.endpoint,
        user: { id: user.id },
      },
      limit: 1,
    });

    const data = {
      user: user.id,
      endpoint: normalized.endpoint,
      keys: normalized.keys,
      expirationTime: normalized.expirationTime,
      userAgent,
      revokedAt: null,
      lastUsedAt: new Date().toISOString(),
    };

    const record = existing?.[0]
      ? await strapi.entityService.update('api::push-subscription.push-subscription', existing[0].id, { data })
      : await strapi.entityService.create('api::push-subscription.push-subscription', { data });

    ctx.send({ data: { id: record.id, enabled: true } });
  },

  async remove(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const endpoint = String((ctx.request.body || {}).endpoint || '').trim();
    if (!endpoint) return ctx.badRequest('Missing push endpoint');

    const subscriptions = await strapi.entityService.findMany('api::push-subscription.push-subscription', {
      filters: {
        endpoint,
        user: { id: user.id },
        revokedAt: { $null: true },
      },
      limit: 20,
    });

    const now = new Date().toISOString();
    await Promise.all(subscriptions.map((subscription) => (
      strapi.entityService.update('api::push-subscription.push-subscription', subscription.id, {
        data: { revokedAt: now },
      })
    )));

    ctx.send({ data: { removed: subscriptions.length } });
  },
}));