'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/password-reset/forgot',
      handler: 'password-reset.forgot',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/password-reset/reset',
      handler: 'password-reset.reset',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/password-reset/forgot-phone',
      handler: 'password-reset.forgotPhone',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/password-reset/reset-phone',
      handler: 'password-reset.resetPhone',
      config: { auth: false },
    },
  ],
};
