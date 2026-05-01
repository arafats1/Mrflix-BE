'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/musics/:id/comment',
      handler: 'music.addComment',
      config: {
        auth: {
          scope: [],
        },
      },
    },
  ],
};