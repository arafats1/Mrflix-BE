'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/marketplace-models/admin',
      handler: 'marketplace-model.adminList',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/marketplace-models/admin',
      handler: 'marketplace-model.adminCreate',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/marketplace-models/admin/:id',
      handler: 'marketplace-model.adminDelete',
      config: { auth: false },
    },
  ],
};