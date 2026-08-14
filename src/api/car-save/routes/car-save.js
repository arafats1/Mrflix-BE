'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/cars/saves/:id',
      handler: 'car-save.toggle',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cars/saves/me',
      handler: 'car-save.mine',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/cars/account/profile',
      handler: 'car-save.updateProfile',
      config: { auth: false },
    },
  ],
};
