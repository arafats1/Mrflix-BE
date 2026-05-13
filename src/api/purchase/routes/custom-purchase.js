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
      path: '/purchases/seller-orders',
      handler: 'api::purchase.purchase.sellerOrders',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/purchases/:id/seller-delivery-status',
      handler: 'api::purchase.purchase.updateSellerDeliveryStatus',
      config: {
        auth: false,
      },
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
