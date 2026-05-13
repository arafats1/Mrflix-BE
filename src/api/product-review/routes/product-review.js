'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/product-reviews',
      handler: 'product-review.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/product-reviews',
      handler: 'product-review.create',
      config: {
        auth: false,
      },
    },
  ],
};