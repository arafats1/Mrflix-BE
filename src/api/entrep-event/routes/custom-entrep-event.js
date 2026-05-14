'use strict';

module.exports = {
  routes: [
    { method: 'GET',  path: '/entrep/calendar',  handler: 'entrep-event.calendar', config: { auth: false } },
    { method: 'POST', path: '/entrep/events',    handler: 'entrep-event.createEvent' },
  ],
};
