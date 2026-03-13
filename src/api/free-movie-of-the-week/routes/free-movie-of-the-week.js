'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/free-movie-of-the-week',
      handler: 'free-movie-of-the-week.find',
      config: {
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/free-movie-of-the-week',
      handler: 'free-movie-of-the-week.update',
      config: {
        policies: [],
      },
    },
  ],
};
