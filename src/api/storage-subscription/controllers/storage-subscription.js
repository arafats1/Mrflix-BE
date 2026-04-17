'use strict';

const { submitPayment, getActiveGateway } = require('../../../utils/payment-gateway');
const { getAccessibleSpace, getRequestedSpaceOwnerId } = require('../../../utils/mrkeyp-space');

// Storage pricing tiers (GB options)
const STORAGE_TIERS = [100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000];

module.exports = {
  // Get user's active storage subscription
  async me(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const now = new Date().toISOString();
    const entries = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters: {
        subscriber: { id: space.ownerId },
        status: 'active',
        endDate: { $gte: now },
      },
      sort: 'endDate:desc',
      limit: 1,
    });

    const active = entries && entries.length > 0 ? entries[0] : null;

    // Get free tier info
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const freeGB = settings?.storageFreeTierGB || 1;
    const pricePerMonth = settings?.storagePricePerMonth || 7000;

    return {
      data: {
        hasSubscription: !!active,
        subscription: active,
        freeTierGB: freeGB,
        pricePerMonth,
        tiers: STORAGE_TIERS,
      },
    };
  },

  // List subscriptions (admin or own)
  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    const filters = {};
    if (!isAdmin) filters.subscriber = { id: ctx.state.user.id };

    const entries = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters,
      populate: { subscriber: { fields: ['id', 'username', 'email'] } },
      sort: 'createdAt:desc',
    });

    return { data: entries };
  },

  // Get pricing tiers
  async pricing(ctx) {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const pricePerMonth = settings?.storagePricePerMonth || 7000;
    const freeGB = settings?.storageFreeTierGB || 1;

    const plans = STORAGE_TIERS.map((gb) => ({
      storageGB: gb,
      label: gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`,
      pricePerMonth: pricePerMonth * (gb / 100),
      prices: Array.from({ length: 24 }, (_, i) => ({
        months: i + 1,
        total: pricePerMonth * (gb / 100) * (i + 1),
        label: i + 1 === 1 ? '1 Month' : `${i + 1} Months`,
      })),
    }));

    return { data: { freeGB, pricePerMonth, plans } };
  },

  // Subscribe to storage plan
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const { storageGB, durationMonths: rawDuration, paymentMethod, paymentPhone } =
      ctx.request.body.data || ctx.request.body;

    if (!storageGB || !STORAGE_TIERS.includes(parseInt(storageGB))) {
      return ctx.badRequest(`Invalid storage tier. Choose from: ${STORAGE_TIERS.join(', ')}GB`);
    }

    const durationMonths = Math.min(Math.max(parseInt(rawDuration) || 1, 1), 24);
    const gb = parseInt(storageGB);

    // Get pricing from settings
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const basePricePerMonth = settings?.storagePricePerMonth || 7000;
    const monthlyPrice = basePricePerMonth * (gb / 100);
    const totalPrice = monthlyPrice * durationMonths;

    const ipnId = settings?.pesapalIpnId;
    const activeGateway = settings?.paymentGateway || 'pesapal';

    if (activeGateway === 'pesapal' && !ipnId) {
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }
    if (activeGateway === 'dgateway' && !paymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
    }

    // Check for existing active subscription
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters: {
        subscriber: { id: ctx.state.user.id },
        status: 'active',
        endDate: { $gte: now.toISOString() },
      },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already have an active storage subscription. Wait for it to expire or contact support.');
    }

    const startDate = now;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30 * durationMonths);

    const merchantReference = `STOR_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Create pending subscription
    const entry = await strapi.entityService.create('api::storage-subscription.storage-subscription', {
      data: {
        subscriber: ctx.state.user.id,
        storageGB: gb,
        amount: totalPrice,
        durationMonths,
        paymentMethod: paymentMethod || activeGateway,
        paymentPhone: paymentPhone || '',
        transactionId: merchantReference,
        status: 'pending',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    // Submit payment
    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const frontendUrl = process.env.MRKEYP_URL || process.env.FRONTEND_URL;

      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount: totalPrice,
        description: `MrKeyp ${gb >= 1000 ? gb / 1000 + 'TB' : gb + 'GB'} Storage - ${durationMonths} Month${durationMonths > 1 ? 's' : ''}`,
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

      const updateData = {};
      if (paymentResult.gateway === 'pesapal') {
        updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      } else if (paymentResult.gateway === 'dgateway') {
        updateData.dgatewayReference = paymentResult.reference;
      }

      await strapi.entityService.update('api::storage-subscription.storage-subscription', entry.id, {
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
      strapi.log.error('Storage subscription payment failed:', err);
      await strapi.entityService.update('api::storage-subscription.storage-subscription', entry.id, {
        data: { status: 'cancelled' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  // Check payment status
  async checkStatus(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const { transactionId } = ctx.query;
    if (!transactionId) return ctx.badRequest('transactionId is required');

    const entries = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters: { transactionId, subscriber: { id: ctx.state.user.id } },
      limit: 1,
    });

    if (!entries || entries.length === 0) return ctx.notFound('Subscription not found');

    return { data: entries[0] };
  },

  // Admin: Grant storage to user
  async grant(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) return ctx.forbidden('Only admins can grant storage');

    const { userId, storageGB, durationDays, isUnlimited } = ctx.request.body.data || ctx.request.body;

    if (!userId) return ctx.badRequest('Missing required field: userId');

    const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
    if (!targetUser) return ctx.notFound('User not found');

    // Cancel existing active storage subscriptions
    const now = new Date();
    const existing = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters: { subscriber: { id: userId }, status: 'active', endDate: { $gte: now.toISOString() } },
    });

    for (const sub of existing) {
      await strapi.entityService.update('api::storage-subscription.storage-subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    const days = parseInt(durationDays) || 365;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const entry = await strapi.entityService.create('api::storage-subscription.storage-subscription', {
      data: {
        subscriber: userId,
        storageGB: isUnlimited ? 99999 : (parseInt(storageGB) || 100),
        amount: 0,
        durationMonths: Math.ceil(days / 30),
        paymentMethod: 'admin_granted',
        paymentPhone: 'admin_granted',
        transactionId: `ADMIN_STOR_${Date.now()}`,
        status: 'active',
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
        isUnlimited: !!isUnlimited,
      },
    });

    return { data: entry };
  },

  // Admin: Revoke storage subscription
  async revoke(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) return ctx.forbidden('Only admins can revoke storage');

    const { userId } = ctx.request.body.data || ctx.request.body;
    if (!userId) return ctx.badRequest('userId is required');

    const now = new Date().toISOString();
    const subs = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
      filters: { subscriber: { id: userId }, status: 'active', endDate: { $gte: now } },
    });

    for (const sub of subs) {
      await strapi.entityService.update('api::storage-subscription.storage-subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }

    return { data: { revoked: subs.length } };
  },

  // Admin: Get all storage users with stats
  async adminStats(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) return ctx.forbidden('Admin only');

    const now = new Date().toISOString();

    const [totalUsers, totalFiles, totalFolders, activeSubs, pendingSubs, sharedLinks, files] = await Promise.all([
      strapi.db.query('plugin::users-permissions.user').count({}),
      strapi.db.query('api::storage-file.storage-file').count({}),
      strapi.db.query('api::storage-folder.storage-folder').count({}),
      strapi.db.query('api::storage-subscription.storage-subscription').count({
        where: { status: 'active', endDate: { $gte: now } },
      }),
      strapi.db.query('api::storage-subscription.storage-subscription').count({
        where: { status: 'pending' },
      }),
      strapi.db.query('api::shared-link.shared-link').count({}),
      strapi.entityService.findMany('api::storage-file.storage-file', { limit: -1 }),
    ]);
    const totalStorageUsed = files.reduce((sum, f) => sum + (parseInt(f.size) || 0), 0);

    return {
      data: {
        totalUsers,
        totalFiles,
        totalFolders,
        activeSubs,
        pendingSubs,
        sharedLinks,
        totalStorageUsed,
        totalStorageUsedGB: (totalStorageUsed / (1024 * 1024 * 1024)).toFixed(2),
      },
    };
  },
};
