'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/products/marketplace-impact',
      handler: 'product.marketplaceImpact',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/products/mine',
      handler: 'product.mine',
      config: {},
    },
    {
      method: 'GET',
      path: '/products',
      handler: 'product.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/products/:id',
      handler: 'product.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/products',
      handler: 'product.create',
      config: {},
    },
    {
      method: 'POST',
      path: '/products/:id/book-service',
      handler: 'product.bookService',
      config: {},
    },
    {
      method: 'POST',
      path: '/products/:id/video-like',
      handler: 'product.likeVideo',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/products/:id/video-comments',
      handler: 'product.commentVideo',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    {
      method: 'PUT',
      path: '/products/:id',
      handler: 'product.update',
      config: {},
    },
    {
      method: 'DELETE',
      path: '/products/:id',
      handler: 'product.delete',
      config: {},
    },
  ],
};
