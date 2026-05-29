'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::expo-push-token.expo-push-token');
