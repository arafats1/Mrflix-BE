'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::active-stream.active-stream');
