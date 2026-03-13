'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/ai-chat',
      handler: 'ai-chat.chat',
      config: {
        policies: [],
      },
    },
  ],
};
