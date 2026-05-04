'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/yo/webhook',
      handler: 'yo-webhook.webhook',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/yo/failure',
      handler: 'yo-webhook.failure',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/yo/verify',
      handler: 'yo-webhook.verify',
      config: { auth: false },
    },
  ],
};
