'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::subscription.subscription', ({ strapi }) => ({
  // Get current user's active subscription
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';

    const filters = {};
    if (!isAdmin) {
      filters.subscriber = { id: ctx.state.user.id };
    }

    const entries = await strapi.entityService.findMany('api::subscription.subscription', {
      filters,
      populate: { subscriber: { populate: '*' } },
      sort: 'createdAt:desc',
    });

    return { data: entries };
  },

  // Check if current user has active subscription
  async me(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const now = new Date().toISOString();

    const entries = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now },
      },
      sort: 'endDate:desc',
      limit: 1,
    });

    const active = entries && entries.length > 0 ? entries[0] : null;

    return {
      data: {
        isSubscribed: !!active,
        subscription: active,
      },
    };
  },

  // Subscribe (create subscription)
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;

    if (!paymentMethod || !paymentPhone) {
      return ctx.badRequest('Missing required fields: paymentMethod, paymentPhone');
    }

    // Get subscription price from site settings
    let subscriptionPrice = 20000;
    try {
      const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
      if (settings?.subscriptionPrice) {
        subscriptionPrice = settings.subscriptionPrice;
      }
    } catch (e) {
      // Use default
    }

    // Check if user already has an active subscription
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already have an active subscription');
    }

    // Calculate dates
    const startDate = now;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    const transactionId = `SUB_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create subscription (simulated payment — set to 'pending' + MoMo API in production)
    const entry = await strapi.entityService.create('api::subscription.subscription', {
      data: {
        subscriber: ctx.state.user.id,
        amount: subscriptionPrice,
        paymentMethod,
        paymentPhone,
        transactionId,
        status: 'active', // Simulated — use 'pending' in production until payment confirmed
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    return { data: entry, transactionId };
  },
}));
