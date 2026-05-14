'use strict';

module.exports = {
  routes: [
    { method: 'GET',  path: '/entrep/mentors',       handler: 'entrep-mentorship.listMentors', config: { auth: false } },
    { method: 'POST', path: '/entrep/mentorships',   handler: 'entrep-mentorship.request' },
    { method: 'GET',  path: '/entrep/me/mentorships', handler: 'entrep-mentorship.mine' },
  ],
};
