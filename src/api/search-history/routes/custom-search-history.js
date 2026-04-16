'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/search-histories/stats',
      handler: 'search-history.stats',
      config: {
        policies: [],
      },
    },
    {
      method: 'DELETE',
      path: '/search-histories/clear',
      handler: 'search-history.clear',
      config: {
        policies: [],
      },
    },
  ],
};
