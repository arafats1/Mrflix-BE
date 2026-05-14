'use strict';
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::entrep-enrollment.entrep-enrollment', {
  config: { find: { auth: false }, findOne: { auth: false } },
});
