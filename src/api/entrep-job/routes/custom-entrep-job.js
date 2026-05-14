'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/jobs',           handler: 'entrep-job.createJob' },
    { method: 'PUT',  path: '/entrep/jobs/:id',       handler: 'entrep-job.updateJob' },
    { method: 'DELETE', path: '/entrep/jobs/:id',     handler: 'entrep-job.deleteJob' },
    { method: 'POST', path: '/entrep/jobs/:id/apply', handler: 'entrep-job.apply' },
  ],
};
