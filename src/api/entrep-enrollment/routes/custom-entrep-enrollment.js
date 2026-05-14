'use strict';

module.exports = {
  routes: [
    { method: 'GET',  path: '/entrep/me/enrollments',                       handler: 'entrep-enrollment.myEnrollments' },
    { method: 'POST', path: '/entrep/courses/:id/enroll',                   handler: 'entrep-enrollment.enroll' },
    { method: 'POST', path: '/entrep/courses/:id/progress',                 handler: 'entrep-enrollment.markLessonComplete' },
    { method: 'POST', path: '/entrep/courses/:id/quiz/:quizId/submit',     handler: 'entrep-enrollment.submitQuiz' },
    { method: 'GET',  path: '/entrep/me/certificates',                     handler: 'entrep-enrollment.myCertificates' },
  ],
};
