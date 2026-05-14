'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-quiz.entrep-quiz', { config: { find: { auth: false }, findOne: { auth: false } } });
