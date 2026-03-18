'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/google-mobile-auth/connect',
      handler: 'google-mobile-auth.connect',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/google-mobile-auth/callback',
      handler: 'google-mobile-auth.callback',
      config: {
        auth: false,
      },
    },
  ],
};
