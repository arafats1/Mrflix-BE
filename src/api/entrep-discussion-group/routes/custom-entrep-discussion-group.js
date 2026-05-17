'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/entrep/discussion-groups/mine', handler: 'entrep-discussion-group.mine' },
    { method: 'POST', path: '/entrep/discussion-groups/course/:courseId/create', handler: 'entrep-discussion-group.createCourseGroup' },
    { method: 'POST', path: '/entrep/discussion-groups/course/:courseId/join', handler: 'entrep-discussion-group.joinCourseGroup' },
    { method: 'POST', path: '/entrep/discussion-groups/:id/meeting-link', handler: 'entrep-discussion-group.createMeetingLink' },
  ],
};