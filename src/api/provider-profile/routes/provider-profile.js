'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/provider-profile/me',
      handler: 'provider-profile.updateMe',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/provider-profile/teachers/:id/subscribe',
      handler: 'provider-profile.toggleTeacherSubscription',
      config: { auth: false },
    },
  ],
};
