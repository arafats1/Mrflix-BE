'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-mentorship.entrep-mentorship', { config: { find: { auth: false }, findOne: { auth: false } } });
