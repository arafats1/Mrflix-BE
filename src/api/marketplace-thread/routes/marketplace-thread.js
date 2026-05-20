'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/marketplace-threads',
      handler: 'marketplace-thread.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/marketplace-threads/:id',
      handler: 'marketplace-thread.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/marketplace-threads/find-or-create',
      handler: 'marketplace-thread.findOrCreate',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/marketplace-threads/:id/message',
      handler: 'marketplace-thread.sendMessage',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/marketplace-threads/seller-status/:sellerId',
      handler: 'marketplace-thread.sellerStatus',
      config: { auth: false, middlewares: [] },
    },
    {
      method: 'DELETE',
      path: '/marketplace-threads/:id',
      handler: 'marketplace-thread.deleteThread',
      config: { auth: false },
    },
  ],
};
