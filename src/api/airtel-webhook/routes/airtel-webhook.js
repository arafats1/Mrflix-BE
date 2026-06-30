'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/airtel/callback',
      handler: 'airtel-webhook.callback',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/airtel/verify',
      handler: 'airtel-webhook.verify',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/airtel/config-check',
      handler: 'airtel-webhook.configCheck',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/airtel/uat/cases',
      handler: 'airtel-webhook.uatCases',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/airtel/uat/run-case',
      handler: 'airtel-webhook.uatRunCase',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/airtel/uat/run-action',
      handler: 'airtel-webhook.uatRunAction',
      config: {
        auth: false,
      },
    },
  ],
};
