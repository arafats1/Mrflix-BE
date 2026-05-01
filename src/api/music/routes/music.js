'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::music.music', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});
