'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-application.entrep-application', { config: { find: { auth: false }, findOne: { auth: false } } });
