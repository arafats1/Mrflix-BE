'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/email-notification/send-content-update',
      handler: 'email-notification.sendContentUpdate',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/email-notification/test-expiry',
      handler: 'email-notification.testExpiry',
      config: {
        policies: [],
      },
    },
  ],
};
