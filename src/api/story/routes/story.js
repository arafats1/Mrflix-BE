module.exports = {
  routes: [
    // Public: list published stories
    {
      method: 'GET',
      path: '/stories',
      handler: 'story.find',
      config: { auth: false },
    },
    // Public: get single story
    {
      method: 'GET',
      path: '/stories/:id',
      handler: 'story.findOne',
      config: { auth: false },
    },
    // Authenticated: create story
    {
      method: 'POST',
      path: '/stories',
      handler: 'story.create',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    // Authenticated: update story
    {
      method: 'PATCH',
      path: '/stories/:id',
      handler: 'story.update',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    // Authenticated: delete story
    {
      method: 'DELETE',
      path: '/stories/:id',
      handler: 'story.delete',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    // Authenticated: toggle like
    {
      method: 'POST',
      path: '/stories/:id/like',
      handler: 'story.toggleLike',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    // Authenticated: add comment
    {
      method: 'POST',
      path: '/stories/:id/comment',
      handler: 'story.addComment',
      config: {
        auth: {
          scope: [],
        },
      },
    },
    // Authenticated: record view
    {
      method: 'POST',
      path: '/stories/:id/view',
      handler: 'story.recordView',
      config: {
        auth: {
          scope: [],
        },
      },
    },
  ],
};
