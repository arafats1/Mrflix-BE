'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/airtel/callback',
      handler: 'airtel-webhook.callback',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/airtel/verify',
      handler: 'airtel-webhook.verify',
      config: {
        auth: false,
      },
    },
  ],
};
