'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::education-subject.education-subject', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});