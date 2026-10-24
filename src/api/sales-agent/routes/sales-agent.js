'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/sales-agents',
      handler: 'sales-agent.list',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/sales-agents',
      handler: 'sales-agent.createAgent',
      config: { auth: false },
    },
  ],
};
