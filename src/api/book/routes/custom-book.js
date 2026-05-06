'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/books/:id/like',
      handler: 'book.toggleLike',
      config: { auth: { scope: [] } },
    },
    {
      method: 'POST',
      path: '/books/:id/comment',
      handler: 'book.addComment',
      config: { auth: { scope: [] } },
    },
  ],
};
