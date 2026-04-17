'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const pesapal = require('../../../utils/pesapal');
const { submitPayment, getActiveGateway } = require('../../../utils/payment-gateway');

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

    const { paymentMethod, paymentPhone, durationMonths: rawDuration } = ctx.request.body.data || ctx.request.body;

    // Validate duration (1-12 months)
    const durationMonths = Math.min(Math.max(parseInt(rawDuration) || 1, 1), 12);

    // Get subscription price from site settings
    let subscriptionPrice = 20000;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    if (settings?.subscriptionPrice) {
      subscriptionPrice = settings.subscriptionPrice;
    }

    // Total price for selected duration
    const totalPrice = subscriptionPrice * durationMonths;

    const ipnId = settings?.pesapalIpnId;
    const activeGateway = settings?.paymentGateway || 'pesapal';

    if (activeGateway === 'pesapal' && !ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }
    if (activeGateway === 'dgateway' && !paymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
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

    // Calculate dates — 30 days per month selected
    const startDate = now;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + (30 * durationMonths));

    const merchantReference = `SUB_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pending subscription
    const entry = await strapi.entityService.create('api::subscription.subscription', {
      data: {
        subscriber: ctx.state.user.id,
        amount: totalPrice,
        paymentMethod: paymentMethod || activeGateway,
        paymentPhone: paymentPhone || '',
        transactionId: merchantReference,
        status: 'pending',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    // Submit to active gateway
    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const frontendUrl = process.env.FRONTEND_URL;

      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount: totalPrice,
        description: `Mr.Flix Premium ${durationMonths} Month${durationMonths > 1 ? 's' : ''} Subscription`,
        callbackUrl: `${frontendUrl}/payment/callback`,
        ipnId,
        paymentPhone: paymentPhone || '',
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      // Store tracking ID based on gateway
      const updateData = {};
      if (paymentResult.gateway === 'pesapal') {
        updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      } else if (paymentResult.gateway === 'dgateway') {
        updateData.dgatewayReference = paymentResult.reference;
      }

      await strapi.entityService.update('api::subscription.subscription', entry.id, {
        data: updateData,
      });

      return {
        data: {
          subscriptionId: entry.id,
          transactionId: merchantReference,
          gateway: paymentResult.gateway,
          redirect_url: paymentResult.redirect_url || null,
          order_tracking_id: paymentResult.order_tracking_id || null,
          reference: paymentResult.reference || null,
          paymentStatus: paymentResult.status || null,
        },
      };
    } catch (err) {
      strapi.log.error('Subscription payment order failed:', err);
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
    strapi.log.info(`[sub.checkStatus] txn=${transactionId} status=${sub.status} pesapalId=${sub.pesapalTrackingId || 'none'} dgRef=${sub.dgatewayReference || 'none'}`);

    // If still pending, check payment gateway directly
    if (sub.status === 'pending' && (sub.pesapalTrackingId || sub.dgatewayReference)) {
      try {
        const { checkPaymentStatus } = require('../../../utils/payment-gateway');
        const result = await checkPaymentStatus(strapi, {
          pesapalTrackingId: sub.pesapalTrackingId,
          dgatewayReference: sub.dgatewayReference,
          gateway: sub.dgatewayReference ? 'dgateway' : 'pesapal',
        });
        strapi.log.info(`[sub.checkStatus] Gateway says: ${result.status}`);

        if (result.status === 'completed') {
          await strapi.entityService.update('api::subscription.subscription', sub.id, {
            data: { status: 'active', ...(result.paymentMethod ? { paymentMethod: result.paymentMethod } : {}) },
          });
          return { data: { id: sub.id, status: 'active' } };
        } else if (result.status === 'failed') {
          await strapi.entityService.update('api::subscription.subscription', sub.id, {
            data: { status: 'cancelled' },
          });
          return { data: { id: sub.id, status: 'cancelled' } };
        }
      } catch (err) {
        strapi.log.warn('[checkStatus] Payment gateway query failed:', err.message);
      }
    }

    return { data: { id: sub.id, status: sub.status } };
  },
}));
