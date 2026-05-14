'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-post.entrep-post', { config: { find: { auth: false }, findOne: { auth: false } } });
