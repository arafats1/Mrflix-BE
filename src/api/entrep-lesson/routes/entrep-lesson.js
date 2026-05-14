'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-lesson.entrep-lesson', { config: { find: { auth: false }, findOne: { auth: false } } });
