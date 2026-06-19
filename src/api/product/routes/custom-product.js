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
      config: { auth: false },
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
      path: '/products/seller-catalog/:slug',
      handler: 'product.sellerCatalog',
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
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/products/:id/book-service',
      handler: 'product.bookService',
      config: { auth: false },
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
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/products/:id',
      handler: 'product.delete',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/products/admin/optimize-images',
      handler: 'product.adminOptimizeImages',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/products/admin/:id/images',
      handler: 'product.adminUpdateImages',
      config: {
        auth: false,
      },
    },
  ],
};
