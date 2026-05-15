'use strict';

module.exports = {
  routes: [
    { method: 'GET',  path: '/entrep/mentors',       handler: 'entrep-mentorship.listMentors', config: { auth: false } },
    { method: 'POST', path: '/entrep/mentorships',   handler: 'entrep-mentorship.request' },
    { method: 'GET',  path: '/entrep/me/mentorships', handler: 'entrep-mentorship.mine' },
    { method: 'GET',  path: '/entrep/mentorships/incoming', handler: 'entrep-mentorship.listIncomingRequests' },
    { method: 'POST', path: '/entrep/mentorships/:id/respond', handler: 'entrep-mentorship.respond' },
  ],
};
