'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/dgateway/webhook',
      handler: 'dgateway-webhook.webhook',
      config: {
        auth: false, // DGateway calls this — no JWT
      },
    },
    {
      method: 'POST',
      path: '/dgateway/verify',
      handler: 'dgateway-webhook.verify',
      config: {
        auth: false, // Frontend calls this to check status
      },
    },
  ],
};
