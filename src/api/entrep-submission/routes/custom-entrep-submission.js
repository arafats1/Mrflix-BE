'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/entrep/lessons/:id/questions', handler: 'entrep-submission.askLessonQuestion' },
    { method: 'GET', path: '/entrep/me/lesson-questions', handler: 'entrep-submission.myLessonQuestions' },
    { method: 'GET', path: '/entrep/trainer/questions', handler: 'entrep-submission.trainerLessonQuestions' },
    { method: 'POST', path: '/entrep/questions/:id/respond', handler: 'entrep-submission.respondToLessonQuestion' },
  ],
};