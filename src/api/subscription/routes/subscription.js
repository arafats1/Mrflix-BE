'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/subscriptions',
      handler: 'subscription.find',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/subscriptions/me',
      handler: 'subscription.me',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/subscriptions',
      handler: 'subscription.create',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/subscriptions/grant',
      handler: 'subscription.grant',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/subscriptions/revoke',
      handler: 'subscription.revoke',
      config: {
        policies: [],
      },
    },
  ],
};
