'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-certificate.entrep-certificate', { config: { find: { auth: false }, findOne: { auth: false } } });
