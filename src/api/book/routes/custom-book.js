'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/books/grant-full-access',
      handler: 'book.grantFullAccess',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/books/revoke-full-access',
      handler: 'book.revokeFullAccess',
      config: { auth: false },
    },
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
