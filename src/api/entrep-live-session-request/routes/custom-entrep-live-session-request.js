'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/live-session-requests', handler: 'entrep-live-session-request.request' },
    { method: 'GET', path: '/entrep/me/live-session-requests', handler: 'entrep-live-session-request.mine' },
    { method: 'GET', path: '/entrep/trainer/live-session-requests', handler: 'entrep-live-session-request.incoming' },
    { method: 'POST', path: '/entrep/live-session-requests/:id/respond', handler: 'entrep-live-session-request.respond' },
  ],
};