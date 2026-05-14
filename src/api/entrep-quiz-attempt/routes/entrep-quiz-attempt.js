'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-quiz-attempt.entrep-quiz-attempt', { config: { find: { auth: false }, findOne: { auth: false } } });
