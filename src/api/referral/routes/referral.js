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
      handler: 'referral.find',
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
