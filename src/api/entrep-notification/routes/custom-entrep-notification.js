'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/notifications', handler: 'entrep-notification.mine' },
    { method: 'POST', path: '/entrep/notifications/read-all', handler: 'entrep-notification.readAll' },
    { method: 'POST', path: '/entrep/notifications/:id/read', handler: 'entrep-notification.read' },
  ],
};