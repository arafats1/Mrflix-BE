'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-job.entrep-job', { config: { find: { auth: false }, findOne: { auth: false } } });
