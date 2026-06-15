'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const pesapal = require('../../../utils/pesapal');
const { submitPayment, getActiveGateway } = require('../../../utils/payment-gateway');
const { evaluatePromoCode, incrementPromoUsage } = require('../../../utils/promo-code');

function resolvePaymentCallbackUrl(rawValue, fallbackUrl) {
  const fallback = String(fallbackUrl || '').trim();
  const input = String(rawValue || '').trim();
  if (!input) return fallback;

  if (/^movomarket:\/\//i.test(input)) return input;
  if (/^https?:\/\//i.test(input)) return input;

  return fallback;
}

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

    const { paymentMethod, paymentPhone, durationMonths: rawDuration, promoCode: rawPromoCode, callbackUrl: rawCallbackUrl } = ctx.request.body.data || ctx.request.body;

    // Validate duration (1-12 months)
    const durationMonths = Math.min(Math.max(parseInt(rawDuration) || 1, 1), 12);

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

    // Total price for selected duration (before any promo)
    const baseTotal = exclusivePrice * durationMonths;
    let totalPrice = baseTotal;

    // Apply promo code if provided
    let appliedPromoCode = '';
    let appliedPromoDiscount = 0;
    let appliedPromoRecord = null;
    if (rawPromoCode) {
      const promoEval = await evaluatePromoCode(strapi, rawPromoCode);
      if (!promoEval.ok) {
        return ctx.badRequest(promoEval.reason || 'Invalid promo code');
      }
      appliedPromoRecord = promoEval.record;
      appliedPromoDiscount = promoEval.record.discountPercent;
      appliedPromoCode = promoEval.record.code;
      const discountAmount = Math.floor((baseTotal * appliedPromoDiscount) / 100);
      totalPrice = Math.max(baseTotal - discountAmount, 0);
    }

    const ipnId = settings?.pesapalIpnId;
    const activeGateway = settings?.paymentGateway || 'pesapal';

    if (activeGateway === 'pesapal' && !ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }
    if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !paymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
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

    // Calculate dates — 30 days per month selected
    const startDate = now;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + (30 * durationMonths));

    const merchantReference = `EXCL_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pending subscription
    const entry = await strapi.entityService.create('api::exclusive-subscription.exclusive-subscription', {
      data: {
        subscriber: ctx.state.user.id,
        amount: totalPrice,
        originalAmount: baseTotal,
        promoCode: appliedPromoCode || null,
        promoDiscountPercent: appliedPromoDiscount || 0,
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
      const callbackUrl = resolvePaymentCallbackUrl(rawCallbackUrl, `${frontendUrl}/payment/callback`);

      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount: totalPrice,
        description: `Mr.Flix Exclusive ${durationMonths} Month${durationMonths > 1 ? 's' : ''} Subscription`,
        callbackUrl,
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
      } else if (paymentResult.gateway === 'yo') {
        updateData.yoReference = paymentResult.reference;
      }

      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', entry.id, {
        data: updateData,
      });

      // Bump promo-code usage now that the payment session was created.
      // We accept a small risk of users abandoning checkout — bumping at
      // session-create time keeps usage limits enforceable without a
      // webhook race. Reset/refunds are an admin operation if needed.
      if (appliedPromoRecord?.id) {
        await incrementPromoUsage(strapi, appliedPromoRecord);
      }

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
      strapi.log.error('Exclusive subscription payment order failed:', err);
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

    // If still pending, check payment gateway directly
    if (sub.status === 'pending' && (sub.pesapalTrackingId || sub.dgatewayReference)) {
      try {
        const { checkPaymentStatus } = require('../../../utils/payment-gateway');
        const result = await checkPaymentStatus(strapi, {
          pesapalTrackingId: sub.pesapalTrackingId,
          dgatewayReference: sub.dgatewayReference,
          gateway: sub.dgatewayReference ? 'dgateway' : 'pesapal',
        });

        if (result.status === 'completed') {
          await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
            data: { status: 'active', ...(result.paymentMethod ? { paymentMethod: result.paymentMethod } : {}) },
          });
          return { data: { id: sub.id, status: 'active' } };
        } else if (result.status === 'failed') {
          await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', sub.id, {
            data: { status: 'cancelled' },
          });
          return { data: { id: sub.id, status: 'cancelled' } };
        }
      } catch (err) {
        strapi.log.warn('[exclusive checkStatus] Payment gateway query failed:', err.message);
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
    };

    const data = movies.map((movie) => {
      const m = movie.toJSON ? movie.toJSON() : { ...movie };
      m.priceUGX = defaults.moviePrice;
      return m;
    });

    return { data };
  },
}));
