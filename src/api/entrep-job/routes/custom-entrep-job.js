'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/jobs',           handler: 'entrep-job.createJob' },
    { method: 'POST', path: '/entrep/jobs/:id/apply', handler: 'entrep-job.apply' },
  ],
};
