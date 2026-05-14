'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-profile.entrep-profile', { config: { find: { auth: false }, findOne: { auth: false } } });
