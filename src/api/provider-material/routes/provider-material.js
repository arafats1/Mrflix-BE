'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/provider-materials/mine',
      handler: 'provider-material.mine',
      config: {},
    },
    {
      method: 'GET',
      path: '/provider-materials/summary/me',
      handler: 'provider-material.summary',
      config: {},
    },
    {
      method: 'GET',
      path: '/provider-materials',
      handler: 'provider-material.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/provider-materials/:id',
      handler: 'provider-material.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/provider-materials',
      handler: 'provider-material.create',
      config: {},
    },
    {
      method: 'PUT',
      path: '/provider-materials/:id',
      handler: 'provider-material.update',
      config: {},
    },
    {
      method: 'DELETE',
      path: '/provider-materials/:id',
      handler: 'provider-material.delete',
      config: {},
    }
  ]
};