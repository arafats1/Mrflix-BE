'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/purchases',
      handler: 'purchase.find',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/purchases',
      handler: 'purchase.create',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/purchases/bulk',
      handler: 'purchase.createBulk',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/purchases/status/:transactionId',
      handler: 'purchase.checkStatus',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/purchases/increment-download',
      handler: 'purchase.incrementDownload',
      config: { policies: [] },
    },
  ],
};
