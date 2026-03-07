'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/free-trial-watches/my-status',
      handler: 'free-trial-watch.myStatus',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/free-trial-watches/record',
      handler: 'free-trial-watch.record',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/free-trial-watches/can-watch',
      handler: 'free-trial-watch.canWatch',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/free-trial-watches/admin-list',
      handler: 'free-trial-watch.adminList',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
