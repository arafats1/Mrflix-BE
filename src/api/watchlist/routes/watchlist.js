'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/watchlists',
      handler: 'watchlist.find',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/watchlists',
      handler: 'watchlist.create',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/watchlists/:id',
      handler: 'watchlist.delete',
      config: { policies: [] },
    },
  ],
};
