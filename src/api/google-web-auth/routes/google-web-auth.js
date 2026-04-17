'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/google-web-auth/connect',
      handler: 'google-web-auth.connect',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/google-web-auth/callback',
      handler: 'google-web-auth.callback',
      config: {
        auth: false,
      },
    },
  ],
};