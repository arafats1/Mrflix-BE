'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/provider-profile/me',
      handler: 'provider-profile.updateMe',
      config: {},
    },
  ],
};