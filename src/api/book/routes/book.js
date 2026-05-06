'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::book.book', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});
