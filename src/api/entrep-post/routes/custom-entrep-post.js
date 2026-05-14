'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/posts',            handler: 'entrep-post.createPost' },
    { method: 'POST', path: '/entrep/posts/:id/like',   handler: 'entrep-post.likePost' },
    { method: 'POST', path: '/entrep/posts/:id/comment', handler: 'entrep-post.addComment' },
  ],
};
