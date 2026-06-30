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
    {
      method: 'GET',
      path: '/airtel/config-check',
      handler: 'airtel-webhook.configCheck',
      config: {
        auth: false,
      },
    },
  ],
};
