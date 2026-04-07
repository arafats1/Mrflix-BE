'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::exclusive-subscription.exclusive-subscription');
