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
    {
      method: 'POST',
      path: '/ai-chat/marketplace-description',
      handler: 'ai-chat.generateMarketplaceDescription',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/ai-chat/marketplace-ad-creatives',
      handler: 'ai-chat.generateMarketplaceAdCreatives',
      config: {
        policies: [],
      },
    },
  ],
};
