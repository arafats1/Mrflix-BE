'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/pesapal/ipn',
      handler: 'pesapal-webhook.ipn',
      config: {
        auth: false, // Pesapal calls this — no JWT
      },
    },
    {
      method: 'GET',
      path: '/pesapal/verify',
      handler: 'pesapal-webhook.verify',
      config: {
        auth: false, // Frontend calls this after redirect
      },
    },
  ],
};
