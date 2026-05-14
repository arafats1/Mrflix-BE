'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/products', handler: 'entrep-product.createProduct' },
  ],
};
