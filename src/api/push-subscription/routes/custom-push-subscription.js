'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/push/vapid-public-key',
      handler: 'api::push-subscription.push-subscription.publicKey',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/push/subscriptions',
      handler: 'api::push-subscription.push-subscription.upsert',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    {
      method: 'DELETE',
      path: '/push/subscriptions',
      handler: 'api::push-subscription.push-subscription.remove',
      config: {
        auth: {
          scope: [],
        },
      },
    },
  ],
};