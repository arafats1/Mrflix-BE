'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-cluster.entrep-cluster', { config: { find: { auth: false }, findOne: { auth: false } } });
