'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/purchases',
      handler: 'api::purchase.purchase.find',
    },
    {
      method: 'POST',
      path: '/purchases',
      handler: 'api::purchase.purchase.create',
    },
    {
      method: 'GET',
      path: '/purchases/:id',
      handler: 'api::purchase.purchase.findOne',
    },
    {
      method: 'PUT',
      path: '/purchases/:id',
      handler: 'api::purchase.purchase.update',
    },
    {
      method: 'DELETE',
      path: '/purchases/:id',
      handler: 'api::purchase.purchase.delete',
    },
    {
      method: 'POST',
      path: '/purchases/increment-download',
      handler: 'api::purchase.purchase.incrementDownload',
    },
  ],
};
