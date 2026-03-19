'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/chat-logs',
      handler: 'chat-log.save',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/chat-logs',
      handler: 'chat-log.find',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/chat-logs/:id',
      handler: 'chat-log.findOne',
      config: {
        policies: [],
      },
    },
    {
      method: 'DELETE',
      path: '/chat-logs/:id',
      handler: 'chat-log.delete',
      config: {
        policies: [],
      },
    },
  ],
};
