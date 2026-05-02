'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/child-profiles/mine',
      handler: 'child-profile.mine',
      config: { auth: { scope: [] } },
    },
    {
      method: 'POST',
      path: '/child-profiles',
      handler: 'child-profile.create',
      config: { auth: { scope: [] } },
    },
    {
      method: 'PUT',
      path: '/child-profiles/:id',
      handler: 'child-profile.update',
      config: { auth: { scope: [] } },
    },
    {
      method: 'DELETE',
      path: '/child-profiles/:id',
      handler: 'child-profile.delete',
      config: { auth: { scope: [] } },
    },
    {
      method: 'PATCH',
      path: '/child-profiles/:id/blocks',
      handler: 'child-profile.toggleBlock',
      config: { auth: { scope: [] } },
    },
    {
      method: 'PATCH',
      path: '/child-profiles/:id/allowed',
      handler: 'child-profile.toggleAllowed',
      config: { auth: { scope: [] } },
    },
  ],
};
