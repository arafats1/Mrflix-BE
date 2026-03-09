'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const pesapal = require('../../../utils/pesapal');

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

  // Subscribe (create subscription) — initiates Pesapal payment
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;

    // Get subscription price from site settings
    let subscriptionPrice = 20000;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (settings?.subscriptionPrice) {
      subscriptionPrice = settings.subscriptionPrice;
    }

    const ipnId = settings?.pesapalIpnId;
    if (!ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
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

    const merchantReference = `SUB_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pending subscription
    const entry = await strapi.entityService.create('api::subscription.subscription', {
      data: {
        subscriber: ctx.state.user.id,
        amount: subscriptionPrice,
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
        amount: subscriptionPrice,
        description: `Mr.Flix Premium Monthly Subscription`,
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
      await strapi.entityService.update('api::subscription.subscription', entry.id, {
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
      strapi.log.error('Pesapal subscription order failed:', err);
      await strapi.entityService.update('api::subscription.subscription', entry.id, {
        data: { status: 'cancelled' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  // Admin: Grant premium subscription to a user without payment
  async grant(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can grant subscriptions');
    }

    const { userId, durationDays } = ctx.request.body.data || ctx.request.body;

    if (!userId) {
      return ctx.badRequest('Missing required field: userId');
    }

    const days = parseInt(durationDays) || 30;

    // Check if user exists
    const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
    if (!targetUser) {
      return ctx.notFound('User not found');
    }

    // Cancel any existing active subscription
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: userId },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
    });

    for (const sub of existing) {
      await strapi.entityService.update('api::subscription.subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    // Create granted subscription
    const startDate = now;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const transactionId = `ADMIN_GRANT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const entry = await strapi.entityService.create('api::subscription.subscription', {
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

  // Admin: Revoke (cancel) a user's active subscription
  async revoke(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can revoke subscriptions');
    }

    const { userId } = ctx.request.body.data || ctx.request.body;

    if (!userId) {
      return ctx.badRequest('Missing required field: userId');
    }

    const now = new Date();
    const active = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: userId },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
    });

    for (const sub of active) {
      await strapi.entityService.update('api::subscription.subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    return { data: { revoked: active.length } };
  },

  async incrementDownload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const now = new Date().toISOString();

    // Find active subscription for this user
    const entries = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now },
      },
      sort: 'endDate:desc',
      limit: 1,
    });

    if (!entries || entries.length === 0) {
      return ctx.notFound('No active subscription found for this user');
    }

    const sub = entries[0];

    // Update the download count
    const updated = await strapi.entityService.update('api::subscription.subscription', sub.id, {
      data: {
        downloadCount: (sub.downloadCount || 0) + 1,
      },
    });

    return { data: updated };
  },

  /**
   * Check the status of a pending subscription by transactionId.
   * If still pending, actively queries Pesapal.
   */
  async checkStatus(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { transactionId } = ctx.params;
    if (!transactionId) {
      return ctx.badRequest('Missing transactionId');
    }

    let subs = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: {
        transactionId,
        subscriber: { id: ctx.state.user.id },
      },
      limit: 1,
    });

    if (!subs || subs.length === 0) {
      strapi.log.info(`[sub.checkStatus] No subscription found for txn=${transactionId} user=${ctx.state.user.id}`);
      return ctx.notFound('Subscription not found');
    }

    const sub = subs[0];
    strapi.log.info(`[sub.checkStatus] txn=${transactionId} status=${sub.status} pesapalId=${sub.pesapalTrackingId || 'none'}`);

    // If still pending, check Pesapal directly
    if (sub.status === 'pending' && sub.pesapalTrackingId) {
      try {
        const status = await pesapal.getTransactionStatus(sub.pesapalTrackingId);
        const paymentStatus = (status.payment_status_description || '').toLowerCase();
        strapi.log.info(`[sub.checkStatus] Pesapal says: ${paymentStatus}`);

        if (paymentStatus === 'completed') {
          await strapi.entityService.update('api::subscription.subscription', sub.id, {
            data: { status: 'active', pesapalTrackingId: sub.pesapalTrackingId },
          });
          return { data: { id: sub.id, status: 'active' } };
        } else if (paymentStatus === 'failed' || paymentStatus === 'invalid') {
          await strapi.entityService.update('api::subscription.subscription', sub.id, {
            data: { status: 'cancelled' },
          });
          return { data: { id: sub.id, status: 'cancelled' } };
        }
      } catch (err) {
        strapi.log.warn('[checkStatus] Pesapal query failed:', err.message);
      }
    }

    return { data: { id: sub.id, status: sub.status } };
  },
}));
