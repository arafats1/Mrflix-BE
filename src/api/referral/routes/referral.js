'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/referrals/my-code',
      handler: 'referral.myCode',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/referrals/my-credits',
      handler: 'referral.myCredits',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/referrals/use-credit',
      handler: 'referral.useCredit',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/referrals/apply',
      handler: 'referral.apply',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/referrals',
      handler: 'referral.adminList',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/referrals/settings',
      handler: 'referral.getSettings',
      config: {
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/referrals/settings',
      handler: 'referral.updateSettings',
      config: {
        policies: [],
      },
    },
  ],
};
