'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/car-prequalifications',
      handler: 'car-prequalification.create',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/car-prequalifications/:id/status',
      handler: 'car-prequalification.updateStatus',
      config: { auth: false },
    },
  ],
};
