'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/live-sessions',          handler: 'entrep-live-session.schedule' },
    { method: 'GET',  path: '/entrep/live-sessions/mine',     handler: 'entrep-live-session.mine' },
    { method: 'GET',  path: '/entrep/live-sessions/upcoming', handler: 'entrep-live-session.upcoming', config: { auth: false } },
    { method: 'GET',  path: '/entrep/live-sessions/:id/join', handler: 'entrep-live-session.join' },
    { method: 'POST', path: '/entrep/live-sessions/:id/end',  handler: 'entrep-live-session.end' },
    { method: 'POST', path: '/entrep/live-sessions/whereby/webhook', handler: 'entrep-live-session.wherebyWebhook', config: { auth: false } },
  ],
};
