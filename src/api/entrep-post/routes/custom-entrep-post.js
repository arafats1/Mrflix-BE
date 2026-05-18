'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/posts',             handler: 'entrep-post.find', config: { auth: false } },
    { method: 'POST', path: '/entrep/posts',            handler: 'entrep-post.createPost' },
    { method: 'DELETE', path: '/entrep/posts/:id',      handler: 'entrep-post.deletePost' },
    { method: 'POST', path: '/entrep/posts/:id/like',   handler: 'entrep-post.likePost' },
    { method: 'POST', path: '/entrep/posts/:id/comment', handler: 'entrep-post.addComment' },
  ],
};
