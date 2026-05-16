'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/auth/register', handler: 'entrep-profile.register', config: { auth: false } },
    { method: 'GET',  path: '/entrep/me',                  handler: 'entrep-profile.me' },
    { method: 'PUT',  path: '/entrep/me',                  handler: 'entrep-profile.updateMe' },
    { method: 'POST', path: '/entrep/me/become-mentor',    handler: 'entrep-profile.becomeMentor' },
    { method: 'POST', path: '/entrep/me/complete-onboarding', handler: 'entrep-profile.completeOnboarding' },
    { method: 'POST', path: '/entrep/me/save-job/:id',     handler: 'entrep-profile.saveJob' },
    { method: 'DELETE', path: '/entrep/me/save-job/:id',   handler: 'entrep-profile.unsaveJob' },
  ],
};
