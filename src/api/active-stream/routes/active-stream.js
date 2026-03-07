'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/active-streams/heartbeat',
      handler: 'active-stream.heartbeat',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/active-streams/stop',
      handler: 'active-stream.stop',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/active-streams/admin-list',
      handler: 'active-stream.adminList',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
