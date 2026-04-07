'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/exclusive-subscriptions',
      handler: 'exclusive-subscription.find',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/exclusive-subscriptions/me',
      handler: 'exclusive-subscription.me',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/exclusive-subscriptions',
      handler: 'exclusive-subscription.create',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/exclusive-subscriptions/grant',
      handler: 'exclusive-subscription.grant',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/exclusive-subscriptions/revoke',
      handler: 'exclusive-subscription.revoke',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/exclusive-subscriptions/status/:transactionId',
      handler: 'exclusive-subscription.checkStatus',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/exclusive-subscriptions/xxx-content',
      handler: 'exclusive-subscription.getXXXContent',
      config: {
        policies: [],
      },
    },
  ],
};
