'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::site-setting.site-setting', ({ strapi }) => ({
  // Public read — anyone can read pricing
  async find(ctx) {
    const entry = await strapi.entityService.findMany('api::site-setting.site-setting');
    // If no settings exist yet, return defaults
    if (!entry) {
      return {
        data: {
          moviePrice: 2000,
          seriesPrice: 5000,
          subscriptionPrice: 20000,
          subscriptionEnabled: true,
        },
      };
    }
    return { data: entry };
  },

  // Admin-only update
  async createOrUpdate(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }
    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can update settings');
    }

    const inputData = ctx.request.body.data || ctx.request.body;
    const existing = await strapi.entityService.findMany('api::site-setting.site-setting');

    let entry;
    if (existing?.id) {
      entry = await strapi.entityService.update('api::site-setting.site-setting', existing.id, {
        data: inputData,
      });
    } else {
      entry = await strapi.entityService.create('api::site-setting.site-setting', {
        data: inputData,
      });
    }

    return { data: entry };
  },

  async incrementDownload(ctx) {
    const existing = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (!existing) {
      return ctx.notFound('Site setting not found');
    }
    const updated = await strapi.entityService.update('api::site-setting.site-setting', existing.id, {
      data: {
        apkDownloadCount: (existing.apkDownloadCount || 0) + 1,
      },
    });
    return { data: updated };
  },

  async incrementMobileDownload(ctx) {
    const existing = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (!existing) {
      return ctx.notFound('Site setting not found');
    }
    const updated = await strapi.entityService.update('api::site-setting.site-setting', existing.id, {
      data: {
        mobileApkDownloadCount: (existing.mobileApkDownloadCount || 0) + 1,
      },
    });
    return { data: updated };
  },
}));
