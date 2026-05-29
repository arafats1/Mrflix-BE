'use strict';

const webpush = require('web-push');

let configuredFor = null;

function getPublicVapidKey() {
  return String(process.env.WEB_PUSH_PUBLIC_KEY || '').trim();
}

function getPrivateVapidKey() {
  return String(process.env.WEB_PUSH_PRIVATE_KEY || '').trim();
}

function getVapidSubject() {
  const configured = String(process.env.WEB_PUSH_SUBJECT || '').trim();
  if (configured) return configured;
  return process.env.FRONTEND_URL || process.env.PUBLIC_URL || 'mailto:support@movobrands.com';
}

function isPushConfigured() {
  return Boolean(getPublicVapidKey() && getPrivateVapidKey());
}

function configureWebPush() {
  if (!isPushConfigured()) return false;

  const signature = `${getVapidSubject()}::${getPublicVapidKey()}::${getPrivateVapidKey()}`;
  if (configuredFor === signature) return true;

  webpush.setVapidDetails(getVapidSubject(), getPublicVapidKey(), getPrivateVapidKey());
  configuredFor = signature;
  return true;
}

async function sendPushToUser(strapi, recipientId, payload = {}) {
  const userId = Number(recipientId);
  if (!userId || !configureWebPush()) return;

  const subscriptions = await strapi.entityService.findMany('api::push-subscription.push-subscription', {
    filters: {
      user: { id: userId },
      revokedAt: { $null: true },
    },
    limit: 100,
  });

  if (!subscriptions.length) return;

  const now = new Date().toISOString();
  await Promise.all(subscriptions.map(async (record) => {
    const subscription = {
      endpoint: record.endpoint,
      keys: record.keys,
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      await strapi.entityService.update('api::push-subscription.push-subscription', record.id, {
        data: { lastUsedAt: now },
      });
    } catch (err) {
      const statusCode = Number(err?.statusCode || err?.status || 0);
      if ([404, 410].includes(statusCode)) {
        await strapi.entityService.update('api::push-subscription.push-subscription', record.id, {
          data: { revokedAt: now },
        });
        return;
      }
      strapi.log.warn(`Web push send failed for user ${userId}: ${err.message}`);
    }
  }));
}

module.exports = {
  getPublicVapidKey,
  isPushConfigured,
  sendPushToUser,
};