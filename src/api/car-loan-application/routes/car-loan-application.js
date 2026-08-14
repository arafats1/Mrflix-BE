'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/car-loan-applications',
      handler: 'car-loan-application.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/car-loan-applications/mine',
      handler: 'car-loan-application.mine',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/cars/admin/overview',
      handler: 'car-loan-application.adminOverview',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/car-loan-applications/:id/status',
      handler: 'car-loan-application.updateStatus',
      config: { auth: false },
    },
  ],
};
