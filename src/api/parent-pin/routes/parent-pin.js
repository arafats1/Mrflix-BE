'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/parent-pin',
      handler: 'parent-pin.set',
      config: {
        auth: { scope: [] },
      },
    },
    {
      method: 'POST',
      path: '/parent-pin/verify',
      handler: 'parent-pin.verify',
      config: {
        auth: { scope: [] },
      },
    },
  ],
};