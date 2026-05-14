'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-course.entrep-course', { config: { find: { auth: false }, findOne: { auth: false } } });
