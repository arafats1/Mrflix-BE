'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/notifications', handler: 'entrep-notification.mine', config: { auth: false } },
    { method: 'POST', path: '/entrep/notifications/read-all', handler: 'entrep-notification.readAll', config: { auth: false } },
    { method: 'POST', path: '/entrep/notifications/clear', handler: 'entrep-notification.clear', config: { auth: false } },
    { method: 'POST', path: '/entrep/notifications/:id/read', handler: 'entrep-notification.read', config: { auth: false } },
  ],
};