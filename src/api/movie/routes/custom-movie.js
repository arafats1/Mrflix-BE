'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/movies/most-watched',
      handler: 'movie.mostWatched',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/movies/:id/increment-watch',
      handler: 'movie.incrementWatch',
      config: {
        policies: [],
      },
    },
  ],
};
