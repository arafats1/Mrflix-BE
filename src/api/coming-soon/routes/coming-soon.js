'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/coming-soon',
      handler: 'coming-soon.find',
      config: {
        policies: [],
      },
    },
  ],
};
