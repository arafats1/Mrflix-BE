'use strict';

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

/**
 * Send an Expo push notification to all active devices registered by a user.
 *
 * @param {object} strapi - Strapi instance
 * @param {number|string} recipientId - User ID
 * @param {object} payload
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {string} [payload.url] - Deep-link URL (sent in data)
 * @param {object} [payload.data] - Extra data
 */
async function sendExpoPushToUser(strapi, recipientId, payload) {
  const userId = Number(recipientId);
  if (!userId) return;

  const records = await strapi.entityService.findMany('api::expo-push-token.expo-push-token', {
    filters: { user: { id: userId }, revokedAt: { $null: true } },
    limit: 20,
  });

  if (!records || records.length === 0) return;

  const messages = records.map((r) => ({
    to: r.token,
    title: payload.title || 'Notification',
    body: payload.body || '',
    data: {
      url: payload.url || '/(tabs)/',
      ...(payload.data || {}),
    },
    sound: 'default',
    channelId: 'default',
  }));

  const response = await fetch(EXPO_PUSH_API, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Expo push API returned ${response.status}: ${text}`);
  }

  // Update lastUsedAt for dispatched tokens
  const now = new Date().toISOString();
  await Promise.all(records.map((r) =>
    strapi.entityService.update('api::expo-push-token.expo-push-token', r.id, {
      data: { lastUsedAt: now },
    }).catch(() => {})
  ));
}

module.exports = { sendExpoPushToUser };
