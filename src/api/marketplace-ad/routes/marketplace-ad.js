'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/marketplace-ads/active',
      handler: 'marketplace-ad.active',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/marketplace-ads/admin',
      handler: 'marketplace-ad.adminList',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/marketplace-ads/admin',
      handler: 'marketplace-ad.adminCreate',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/marketplace-ads/admin/:id',
      handler: 'marketplace-ad.adminUpdate',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/marketplace-ads/admin/:id',
      handler: 'marketplace-ad.adminDelete',
      config: { auth: false },
    }
  ],
};
