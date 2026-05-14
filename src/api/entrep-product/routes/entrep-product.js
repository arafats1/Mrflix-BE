'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-product.entrep-product', { config: { find: { auth: false }, findOne: { auth: false } } });
