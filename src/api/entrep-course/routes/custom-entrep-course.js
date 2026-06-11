'use strict';

module.exports = {
  routes: [
    { method: 'POST',  path: '/entrep/courses',                   handler: 'entrep-course.authorCourse' },
    { method: 'PUT',   path: '/entrep/trainer/courses/:id',       handler: 'entrep-course.updateAuthoredCourse' },
    { method: 'DELETE', path: '/entrep/trainer/courses/:id',      handler: 'entrep-course.deleteAuthoredCourse', config: { auth: false } },
    { method: 'GET',   path: '/entrep/me/courses',                handler: 'entrep-course.myAuthoredCourses' },
    { method: 'GET',   path: '/entrep/admin/overview',            handler: 'entrep-course.adminOverview' },
    { method: 'GET',   path: '/entrep/trainer/courses/:id/overview', handler: 'entrep-course.trainerCourseOverview' },
    { method: 'POST',  path: '/entrep/trainer/courses/:id/material', handler: 'entrep-course.addCourseMaterial' },
    { method: 'PATCH', path: '/entrep/courses/:id/approve',       handler: 'entrep-course.approveCourse' },
  ],
};
