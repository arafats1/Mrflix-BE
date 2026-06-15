'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::site-setting.site-setting', ({ strapi }) => ({
  async adminStats(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can view admin stats');
    }

    const res = await strapi.entityService.findMany('api::site-setting.site-setting');
    const settings = Array.isArray(res) ? res[0] : res;
    const revenueStart = settings?.revenueResetDate
      ? new Date(settings.revenueResetDate)
      : new Date('2026-05-01T00:00:00.000Z');

    const revenueStartIso = revenueStart.toISOString();

    const [
      totalMovies,
      totalSeries,
      totalPurchases,
      pendingRequests,
      totalRequests,
      totalUsers,
      activeSubscriptions,
      totalSubscriptions,
      activeExclusiveSubscriptions,
      totalExclusiveSubscriptions,
      newMessages,
      moviePurchaseRevenueRows,
      subscriptionRevenueRows,
      exclusiveRevenueRows,
      promotionRevenueRows,
    ] = await Promise.all([
      strapi.db.query('api::movie.movie').count({ where: { type: 'movie' } }),
      strapi.db.query('api::movie.movie').count({ where: { type: 'series' } }),
      strapi.db.query('api::purchase.purchase').count({}),
      strapi.db.query('api::movie-request.movie-request').count({ where: { status: 'pending' } }),
      strapi.db.query('api::movie-request.movie-request').count({}),
      strapi.db.query('plugin::users-permissions.user').count({}),
      strapi.db.query('api::subscription.subscription').count({ where: { status: 'active' } }),
      strapi.db.query('api::subscription.subscription').count({}),
      strapi.db.query('api::exclusive-subscription.exclusive-subscription').count({ where: { status: 'active' } }),
      strapi.db.query('api::exclusive-subscription.exclusive-subscription').count({}),
      strapi.db.query('api::contact-message.contact-message').count({ where: { status: 'new' } }),
      strapi.db.query('api::purchase.purchase').findMany({
        where: {
          status: 'completed',
          createdAt: { $gte: revenueStartIso },
          product: { $null: true },
          providerMaterial: { $null: true },
          book: { $null: true },
          movie: { $notNull: true },
        },
        select: ['amount'],
      }),
      strapi.db.query('api::subscription.subscription').findMany({
        where: {
          status: { $in: ['active', 'expired'] },
          createdAt: { $gte: revenueStartIso },
        },
        select: ['amount'],
      }),
      strapi.db.query('api::exclusive-subscription.exclusive-subscription').findMany({
        where: {
          status: { $in: ['active', 'expired'] },
          createdAt: { $gte: revenueStartIso },
        },
        select: ['amount'],
      }),
      strapi.db.query('api::marketplace-promotion.marketplace-promotion').findMany({
        where: {
          status: { $in: ['active', 'expired'] },
          createdAt: { $gte: revenueStartIso },
        },
        select: ['amount'],
      }).catch(() => []),
    ]);

    const moviePurchaseRevenue = (moviePurchaseRevenueRows || []).reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const subscriptionRevenue = (subscriptionRevenueRows || []).reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const exclusiveRevenue = (exclusiveRevenueRows || []).reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const promotionRevenue = (promotionRevenueRows || []).reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const movieRevenue = moviePurchaseRevenue + subscriptionRevenue;

    return {
      data: {
        totalMovies,
        totalSeries,
        totalPurchases,
        pendingRequests,
        totalRequests,
        movieRevenue,
        totalRevenue: movieRevenue,
        totalUsers,
        activeSubscriptions,
        totalSubscriptions,
        subscriptionRevenue,
        activeExclusiveSubscriptions,
        totalExclusiveSubscriptions,
        exclusiveRevenue,
        promotionRevenue,
        apkDownloadCount: settings?.apkDownloadCount || 0,
        apkDownloadMobileCount: settings?.apkDownloadMobileCount || 0,
        newMessages,
      },
    };
  },

  // Public read — anyone can read pricing
  async find(ctx) {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const entry = Array.isArray(settings) ? settings[0] : settings;
    // If no settings exist yet, return defaults
    if (!entry) {
      return {
        data: {
          moviePrice: 0,
          seriesPrice: 0,
          subscriptionPrice: 10000,
          bookSubscriptionPrice: 10000,
          subscriptionEnabled: true,
          storageFreeTierGB: 1,
          storagePricePerMonth: 7000,
          storageEnabled: true,
          marketplacePromotionDailyPrice: 5000,
          marketplacePromotionMonthlyPrice: 100000,
          homesContactUnlockFeeUGX: 10000,
          paymentGateway: 'pesapal',
        },
      };
    }
    return {
      data: {
        ...entry,
        bookSubscriptionPrice: entry.bookSubscriptionPrice ?? 10000,
        homesContactUnlockFeeUGX: entry.homesContactUnlockFeeUGX ?? 10000,
      },
    };
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
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const existing = Array.isArray(settings) ? settings[0] : settings;

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
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const existing = Array.isArray(settings) ? settings[0] : settings;
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
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const existing = Array.isArray(settings) ? settings[0] : settings;
    if (!existing) {
      return ctx.notFound('Site setting not found');
    }
    const updated = await strapi.entityService.update('api::site-setting.site-setting', existing.id, {
      data: {
        apkDownloadMobileCount: (existing.apkDownloadMobileCount || 0) + 1,
      },
    });
    return { data: updated };
  },
}));
