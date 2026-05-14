'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-submission.entrep-submission', { config: { find: { auth: false }, findOne: { auth: false } } });
