'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-module.entrep-module', { config: { find: { auth: false }, findOne: { auth: false } } });
