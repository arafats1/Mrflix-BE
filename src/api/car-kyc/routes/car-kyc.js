'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/cars/kyc',
      handler: 'car-kyc.mine',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/cars/kyc',
      handler: 'car-kyc.upsert',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cars/admin/kyc',
      handler: 'car-kyc.adminList',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/cars/admin/kyc/:id',
      handler: 'car-kyc.review',
      config: { auth: false },
    },
  ],
};
