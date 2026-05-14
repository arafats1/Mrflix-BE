'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/live-sessions',          handler: 'entrep-live-session.schedule' },
    { method: 'GET',  path: '/entrep/live-sessions/upcoming', handler: 'entrep-live-session.upcoming', config: { auth: false } },
    { method: 'GET',  path: '/entrep/live-sessions/:id/join', handler: 'entrep-live-session.join' },
  ],
};
