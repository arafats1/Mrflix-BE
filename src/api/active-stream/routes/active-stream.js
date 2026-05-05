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
    {
      method: 'GET',
      path: '/active-streams/admin-history',
      handler: 'active-stream.adminHistory',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/active-streams/parent-history',
      handler: 'active-stream.parentHistory',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/active-streams/continue-watching',
      handler: 'active-stream.continueWatching',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/active-streams/dismiss',
      handler: 'active-stream.dismiss',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/active-streams/clear-history',
      handler: 'active-stream.clearHistory',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
