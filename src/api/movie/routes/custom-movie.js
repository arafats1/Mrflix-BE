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
  ],
};
