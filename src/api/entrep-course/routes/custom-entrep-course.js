'use strict';

module.exports = {
  routes: [
    { method: 'POST',  path: '/entrep/courses',                   handler: 'entrep-course.authorCourse' },
    { method: 'GET',   path: '/entrep/me/courses',                handler: 'entrep-course.myAuthoredCourses' },
    { method: 'PATCH', path: '/entrep/courses/:id/approve',       handler: 'entrep-course.approveCourse' },
  ],
};
