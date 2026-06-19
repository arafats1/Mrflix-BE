'use strict';

const AUTHENTICATED = { auth: false };

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/jobs/mine', handler: 'entrep-job.mine', config: AUTHENTICATED },
    { method: 'POST', path: '/entrep/jobs', handler: 'entrep-job.createJob', config: AUTHENTICATED },
    { method: 'PUT', path: '/entrep/jobs/:id', handler: 'entrep-job.updateJob', config: AUTHENTICATED },
    { method: 'DELETE', path: '/entrep/jobs/:id', handler: 'entrep-job.deleteJob', config: AUTHENTICATED },
    { method: 'POST', path: '/entrep/jobs/:id/apply', handler: 'entrep-job.apply', config: AUTHENTICATED },
  ],
};
