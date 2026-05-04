'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/phone-verification/send',
      handler: 'phone-verification.send',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/phone-verification/verify',
      handler: 'phone-verification.verify',
      config: { auth: false },
    },
  ],
};
