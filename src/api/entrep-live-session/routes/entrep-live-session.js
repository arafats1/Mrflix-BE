'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-live-session.entrep-live-session', {
  config: { find: { auth: false }, findOne: { auth: false } },
});
