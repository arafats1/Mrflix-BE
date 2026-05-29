'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/push/expo-token',
      handler: 'api::expo-push-token.expo-push-token.upsert',
    },
    {
      method: 'DELETE',
      path: '/push/expo-token',
      handler: 'api::expo-push-token.expo-push-token.remove',
    },
  ],
};
