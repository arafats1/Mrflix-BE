'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/me/assignments', handler: 'entrep-assignment.myAssignments', config: { auth: false } },
    { method: 'GET', path: '/entrep/trainer/courses/:id/assignments', handler: 'entrep-assignment.listForTrainerCourse', config: { auth: false } },
    { method: 'POST', path: '/entrep/trainer/courses/:id/assignments', handler: 'entrep-assignment.createForCourse', config: { auth: false } },
    { method: 'POST', path: '/entrep/assignments/:id/submit', handler: 'entrep-assignment.submit', config: { auth: false } },
    { method: 'POST', path: '/entrep/submissions/:id/grade', handler: 'entrep-assignment.gradeSubmission', config: { auth: false } },
  ],
};