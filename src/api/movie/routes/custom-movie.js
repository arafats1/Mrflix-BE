'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/movies/most-watched',
      handler: 'movie.mostWatched',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/movies/:id/increment-watch',
      handler: 'movie.incrementWatch',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/movies/bulk-drafts',
      handler: 'movie.bulkDrafts',
      config: {
        // Auth required; the controller itself enforces admin-only access
        // by inspecting ctx.state.user.role.
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/movies/bunny/create-upload',
      handler: 'movie.bunnyCreateUpload',
      config: {
        // Admin-only check happens inside the controller.
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/movies/bunny/encode-status/:videoId',
      handler: 'movie.bunnyEncodeStatus',
      config: {
        // Admin-only check happens inside the controller.
        policies: [],
      },
    },
  ],
};
