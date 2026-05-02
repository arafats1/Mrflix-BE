'use strict';

module.exports = {
  routes: [
    // Admin CRUD — admin gate enforced inside controller
    {
      method: 'GET',
      path: '/promo-codes',
      handler: 'promo-code.find',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/promo-codes/:id',
      handler: 'promo-code.findOne',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/promo-codes',
      handler: 'promo-code.create',
      config: { policies: [] },
    },
    {
      method: 'PUT',
      path: '/promo-codes/:id',
      handler: 'promo-code.update',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/promo-codes/:id',
      handler: 'promo-code.delete',
      config: { policies: [] },
    },
    // Public auth — validate a code at checkout
    {
      method: 'POST',
      path: '/promo-codes/validate',
      handler: 'promo-code.validate',
      config: { policies: [] },
    },
  ],
};
