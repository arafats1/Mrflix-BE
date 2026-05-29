'use strict';

const webpush = require('web-push');

let configuredFor = null;

function normalizeEnvValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function isValidPublicVapidKey(value) {
  const key = normalizeEnvValue(value);
  if (!key) return false;

  try {
    const normalized = key.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Buffer.from(padded, 'base64');
    return bytes.length === 65 && bytes[0] === 4;
  } catch {
    return false;
  }
}

function getPublicVapidKey() {
  return normalizeEnvValue(process.env.WEB_PUSH_PUBLIC_KEY);
}

function getPrivateVapidKey() {
  return normalizeEnvValue(process.env.WEB_PUSH_PRIVATE_KEY);
}

function getVapidSubject() {
  const configured = normalizeEnvValue(process.env.WEB_PUSH_SUBJECT);
  if (configured) return configured;
  return process.env.FRONTEND_URL || process.env.PUBLIC_URL || 'mailto:support@movobrands.com';
}

function isPushConfigured() {
  return Boolean(isValidPublicVapidKey(getPublicVapidKey()) && getPrivateVapidKey());
}

function configureWebPush() {
  if (!isPushConfigured()) return false;

  const signature = `${getVapidSubject()}::${getPublicVapidKey()}::${getPrivateVapidKey()}`;
  if (configuredFor === signature) return true;

  webpush.setVapidDetails(getVapidSubject(), getPublicVapidKey(), getPrivateVapidKey());
  configuredFor = signature;
  return true;
}

function getEndpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown-provider';
  }
}

function summarizePushError(err) {
  const statusCode = Number(err?.statusCode || err?.status || 0);
  const body = err?.body ? String(err.body).replace(/\s+/g, ' ').slice(0, 220) : '';
  return {
    statusCode,
    body,
    message: err?.message || 'Unknown push provider error',
  };
}

function shouldRevokeFailedSubscription(err) {
  const { statusCode } = summarizePushError(err);
  return [400, 403, 404, 410].includes(statusCode);
}

async function revokeSubscription(strapi, record, now) {
  await strapi.entityService.update('api::push-subscription.push-subscription', record.id, {
    data: { revokedAt: now },
  });
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
      const summary = summarizePushError(err);
      if (shouldRevokeFailedSubscription(err)) {
        await revokeSubscription(strapi, record, now);
        strapi.log.warn(`Web push subscription revoked for user ${userId}: status=${summary.statusCode || 'unknown'} provider=${getEndpointHost(record.endpoint)} body=${summary.body || summary.message}`);
        return;
      }
      strapi.log.warn(`Web push send failed for user ${userId}: status=${summary.statusCode || 'unknown'} provider=${getEndpointHost(record.endpoint)} body=${summary.body || summary.message}`);
    }
  }));
}

module.exports = {
  getPublicVapidKey,
  isPushConfigured,
  isValidPublicVapidKey,
  sendPushToUser,
};