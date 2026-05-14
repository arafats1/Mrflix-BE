'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-event.entrep-event', { config: { find: { auth: false }, findOne: { auth: false } } });
