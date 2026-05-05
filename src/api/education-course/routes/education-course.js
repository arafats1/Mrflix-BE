'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::education-course.education-course', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});