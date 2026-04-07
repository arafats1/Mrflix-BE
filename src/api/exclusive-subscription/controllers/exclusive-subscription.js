'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const pesapal = require('../../../utils/pesapal');

module.exports = createCoreController('api::exclusive-subscription.exclusive-subscription', ({ strapi }) => ({
  // Admin: list all exclusive subscriptions
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';

    const filters = {};
    if (!isAdmin) {
      filters.subscriber = { id: ctx.state.user.id };
    }

    const entries = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters,
      populate: { subscriber: { populate: '*' } },
      sort: 'createdAt:desc',
    });

    return { data: entries };
  },

  // Check if current user has active exclusive subscription
  async me(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const now = new Date().toISOString();

    const entries = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
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
        isExclusiveSubscribed: !!active,
        subscription: active,
      },
    };
  },

  // Subscribe to exclusive plan — initiates Pesapal payment
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;

    // Get exclusive subscription price from site settings
    let exclusivePrice = 50000;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (settings?.exclusivePrice) {
      exclusivePrice = settings.exclusivePrice;
    }

    // If user already has active premium subscription, charge only the difference
    const premiumNow = new Date().toISOString();
    const activePremium = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: premiumNow },
      },
      limit: 1,
    });
    const premiumPrice = settings?.subscriptionPrice || 20000;
    if (activePremium && activePremium.length > 0) {
      exclusivePrice = Math.max(exclusivePrice - premiumPrice, 0);
    }

    const ipnId = settings?.pesapalIpnId;
    if (!ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }

    // Check if user already has an active exclusive subscription
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already have an active exclusive subscription');
    }

    // Calculate dates
    const startDate = now;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    const merchantReference = `EXCL_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pending subscription
    const entry = await strapi.entityService.create('api::exclusive-subscription.exclusive-subscription', {
      data: {
        subscriber: ctx.state.user.id,
        amount: exclusivePrice,
        paymentMethod: paymentMethod || 'pesapal',
        paymentPhone: paymentPhone || '',
        transactionId: merchantReference,
        status: 'pending',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    // Submit to Pesapal
    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      const pesapalOrder = await pesapal.submitOrder({
        merchantReference,
        amount: exclusivePrice,
        description: 'Mr.Flix Exclusive Monthly Subscription',
        callbackUrl: `${frontendUrl}/payment/callback`,
        ipnId,
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      // Store tracking ID
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', entry.id, {
        data: { pesapalTrackingId: pesapalOrder.order_tracking_id },
      });

      return {
        data: {
          subscriptionId: entry.id,
          transactionId: merchantReference,
          redirect_url: pesapalOrder.redirect_url,
          order_tracking_id: pesapalOrder.order_tracking_id,
        },
      };
    } catch (err) {
      strapi.log.error('Pesapal exclusive subscription order failed:', err);
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', entry.id, {
        data: { status: 'cancelled' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  // Admin: Grant exclusive subscription to a user without payment
  async grant(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can grant exclusive subscriptions');
    }

    const { userId, durationDays } = ctx.request.body.data || ctx.request.body;

    if (!userId) {
      return ctx.badRequest('Missing required field: userId');
    }

    const days = parseInt(durationDays) || 30;

    const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
    if (!targetUser) {
      return ctx.notFound('User not found');
    }

    // Cancel any existing active exclusive subscription
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: {
        subscriber: { id: userId },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
    });

    for (const sub of existing) {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    const startDate = now;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const transactionId = `ADMIN_EXCL_GRANT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const entry = await strapi.entityService.create('api::exclusive-subscription.exclusive-subscription', {
      data: {
        subscriber: userId,
        amount: 0,
        paymentMethod: 'mtn_momo',
        paymentPhone: 'admin_granted',
        transactionId,
        status: 'active',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    return { data: entry };
  },

  // Admin: Revoke a user's active exclusive subscription
  async revoke(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can revoke exclusive subscriptions');
    }

    const { userId } = ctx.request.body.data || ctx.request.body;

    if (!userId) {
      return ctx.badRequest('Missing required field: userId');
    }

    const now = new Date();
    const active = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: {
        subscriber: { id: userId },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
    });

    for (const sub of active) {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    return { data: { revoked: active.length } };
  },

  // Check status of a pending exclusive subscription
  async checkStatus(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { transactionId } = ctx.params;
    if (!transactionId) {
      return ctx.badRequest('Missing transactionId');
    }

    let subs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: {
        transactionId,
        subscriber: { id: ctx.state.user.id },
      },
      limit: 1,
    });

    if (!subs || subs.length === 0) {
      return ctx.notFound('Exclusive subscription not found');
    }

    const sub = subs[0];

    // If still pending, check Pesapal directly
    if (sub.status === 'pending' && sub.pesapalTrackingId) {
      try {
        const status = await pesapal.getTransactionStatus(sub.pesapalTrackingId);
        const paymentStatus = (status.payment_status_description || '').toLowerCase();

        if (paymentStatus === 'completed') {
          await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
            data: { status: 'active', pesapalTrackingId: sub.pesapalTrackingId },
          });
          return { data: { id: sub.id, status: 'active' } };
        } else if (paymentStatus === 'failed' || paymentStatus === 'invalid') {
          await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
            data: { status: 'cancelled' },
          });
          return { data: { id: sub.id, status: 'cancelled' } };
        }
      } catch (err) {
        strapi.log.warn('[exclusive checkStatus] Pesapal query failed:', err.message);
      }
    }

    return { data: { id: sub.id, status: sub.status } };
  },

  // Get XXX content — only for users with active exclusive subscription
  async getXXXContent(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Verify active exclusive subscription
    const now = new Date().toISOString();
    const activeSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now },
      },
      limit: 1,
    });

    if (!activeSubs || activeSubs.length === 0) {
      return ctx.forbidden('Active exclusive subscription required');
    }

    const limit = Math.min(parseInt(ctx.query.limit) || 16, 50);

    const movies = await strapi.entityService.findMany('api::movie.movie', {
      filters: {
        isAvailable: true,
        isXXX: true,
      },
      populate: ['poster', 'backdrop'],
      sort: 'createdAt:desc',
      limit,
    });

    // Apply site-setting default prices
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const defaults = {
      moviePrice: settings?.moviePrice ?? 2000,
      seriesPrice: settings?.seriesPrice ?? 5000,
    };

    const data = movies.map((movie) => {
      const m = movie.toJSON ? movie.toJSON() : { ...movie };
      m.priceUGX = m.type === 'series' ? defaults.seriesPrice : defaults.moviePrice;
      return m;
    });

    return { data };
  },
}));
