'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/site-setting',
      handler: 'site-setting.find',
      config: {
        auth: false, // Public — pricing is visible to everyone
      },
    },
    {
      method: 'PUT',
      path: '/site-setting',
      handler: 'site-setting.createOrUpdate',
      config: {
        policies: [],
      },
    },
  ],
};
