'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { submitPayment, checkPaymentStatus } = require('../../../utils/payment-gateway');
const { activatePromotion } = require('../../../utils/marketplace-promotions');

function isAdminUser(user) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin';
}

function clampDays(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 30);
}

function normalizeUgPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('256')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `256${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 9) return `256${digits}`;
  return digits;
}

function normalizeStringMap(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.entries(input).reduce((acc, [key, value]) => {
    const safeKey = String(key || '').trim().slice(0, 40);
    const safeValue = String(value || '').trim().slice(0, 300);
    if (safeKey && safeValue) acc[safeKey] = safeValue;
    return acc;
  }, {});
}

function normalizeChannels(input = []) {
  const allowed = new Set(['facebook', 'instagram', 'tiktok', 'x']);
  return [...new Set((Array.isArray(input) ? input : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => allowed.has(value)))]
    .slice(0, 4);
}

function normalizeCreativeAssets(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((asset) => ({
      id: String(asset?.id || '').trim().slice(0, 80),
      format: String(asset?.format || 'square_feed').trim().slice(0, 40),
      imageUrl: String(asset?.imageUrl || '').trim().slice(0, 1000),
      headline: String(asset?.headline || '').trim().slice(0, 120),
      primaryText: String(asset?.primaryText || '').trim().slice(0, 400),
      description: String(asset?.description || '').trim().slice(0, 200),
      callToAction: String(asset?.callToAction || '').trim().slice(0, 40),
    }))
    .filter((asset) => asset.imageUrl || asset.headline || asset.primaryText)
    .slice(0, 8);
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getSettings(strapi) {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  if (Array.isArray(settings)) return settings[0] || {};
  return settings || {};
}

function getPromotionPricing(settings = {}) {
  return {
    dailyPrice: Number(settings.marketplacePromotionDailyPrice || 5000),
    monthlyPrice: Number(settings.marketplacePromotionMonthlyPrice || 100000),
    paymentGateway: settings.paymentGateway || 'pesapal',
  };
}

async function findProductForSeller(strapi, productId, sellerId) {
  const normalizedId = decodeURIComponent(String(productId || '')).trim().split(/\s+/)[0];
  if (!normalizedId) return null;

  const filters = /^\d+$/.test(normalizedId)
    ? { id: Number(normalizedId), seller: { id: sellerId } }
    : { documentId: normalizedId, seller: { id: sellerId } };

  const products = await strapi.documents('api::product.product').findMany({
    filters,
    populate: { seller: true },
    limit: 1,
    status: 'published',
  });

  return products?.[0] || null;
}

module.exports = createCoreController('api::marketplace-promotion.marketplace-promotion', ({ strapi }) => ({
  async pricing(ctx) {
    const settings = await getSettings(strapi);
    return { data: getPromotionPricing(settings) };
  },

  async mine(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
      filters: { seller: { id: ctx.state.user.id } },
      populate: { product: true, seller: true },
      sort: { createdAt: 'desc' },
      limit: 100,
    });

    // Self-heal: re-apply product fields for any active promotion whose product
    // somehow lost its promotedUntil (e.g. activated before the DB-write fix).
    const now = Date.now();
    for (const promotion of promotions || []) {
      if (promotion.status !== 'active') continue;
      const endTs = toTimestamp(promotion.endDate);
      if (!endTs || endTs <= now) continue;

      const needsResync = promotion.promotionType === 'seller'
        ? true
        : !promotion.product?.promotedUntil || toTimestamp(promotion.product.promotedUntil) < endTs;

      if (needsResync) {
        try {
          await activatePromotion(strapi, promotion);
        } catch (err) {
          strapi.log.warn(`[promotion] mine resync failed for ${promotion.id}: ${err.message}`);
        }
      }
    }

    return { data: promotions || [] };
  },

  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const payload = ctx.request.body?.data || ctx.request.body || {};
    const promotionType = payload.promotionType === 'seller' ? 'seller' : 'product';
    const durationDays = promotionType === 'seller' ? 30 : clampDays(payload.durationDays);
    const paymentPhone = String(payload.paymentPhone || '').trim();
    const normalizedPaymentPhone = normalizeUgPhone(paymentPhone);
    const productId = payload.productId;
    const channels = normalizeChannels(payload.channels || ['facebook', 'instagram']);
    const socialProfiles = normalizeStringMap(payload.socialProfiles);
    const creativeAssets = normalizeCreativeAssets(payload.creativeAssets);
    const adCampaignNotes = String(payload.adCampaignNotes || '').trim().slice(0, 1000);

    const settings = await getSettings(strapi);
    const pricing = getPromotionPricing(settings);
    const activeGateway = pricing.paymentGateway;
    const amount = promotionType === 'seller'
      ? pricing.monthlyPrice
      : pricing.dailyPrice * durationDays;

    if (amount <= 0) return ctx.badRequest('Promotion pricing is not configured.');
    if (activeGateway === 'pesapal' && !settings.pesapalIpnId) {
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }
    if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !normalizedPaymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
    }

    let product = null;
    if (promotionType === 'product') {
      product = await findProductForSeller(strapi, productId, ctx.state.user.id);
      if (!product) return ctx.notFound('Product not found');
    }

    const merchantReference = `PROMO_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const entry = await strapi.entityService.create('api::marketplace-promotion.marketplace-promotion', {
      data: {
        seller: ctx.state.user.id,
        product: product?.id || null,
        promotionType,
        durationDays,
        amount,
        paymentMethod: activeGateway,
        paymentPhone: normalizedPaymentPhone || paymentPhone,
        transactionId: merchantReference,
        status: 'pending',
        channels,
        socialProfiles,
        creativeAssets,
        adCampaignNotes,
        adFulfillmentStatus: creativeAssets.length || channels.length ? 'ready' : 'draft',
      },
    });

    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const frontendUrl = process.env.FRONTEND_URL || process.env.MRKEYP_URL || 'http://localhost:3000';
      const description = promotionType === 'seller'
        ? 'Marketplace monthly seller promotion'
        : `Marketplace product promotion - ${durationDays} day${durationDays === 1 ? '' : 's'}`;

      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount,
        description,
        callbackUrl: `${frontendUrl}/payment/callback?purchaseType=marketplace_promotion`,
        ipnId: settings.pesapalIpnId,
        paymentPhone,
        billingAddress: {
          email: user.email || '',
          phone: normalizedPaymentPhone || paymentPhone,
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      const updateData = {};
      if (paymentResult.gateway === 'pesapal') updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      if (paymentResult.gateway === 'dgateway') updateData.dgatewayReference = paymentResult.reference;
      if (paymentResult.gateway === 'yo') updateData.yoReference = paymentResult.reference;

      await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', entry.id, { data: updateData });

      return {
        data: {
          promotionId: entry.id,
          transactionId: merchantReference,
          amount,
          gateway: paymentResult.gateway,
          redirect_url: paymentResult.redirect_url || null,
          order_tracking_id: paymentResult.order_tracking_id || null,
          reference: paymentResult.reference || null,
          paymentStatus: paymentResult.status || null,
        },
      };
    } catch (err) {
      strapi.log.error('Marketplace promotion payment failed:', err);
      await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', entry.id, {
        data: { status: 'cancelled' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  async checkStatus(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const transactionId = String(ctx.query.transactionId || '').trim();
    if (!transactionId) return ctx.badRequest('transactionId is required');

    const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
      filters: { transactionId, seller: { id: ctx.state.user.id } },
      populate: { product: true, seller: true },
      limit: 1,
    });

    let promotion = promotions?.[0];
    if (!promotion) return ctx.notFound('Promotion not found');

    if (promotion.status === 'pending') {
      try {
        const gatewayStatus = await checkPaymentStatus(strapi, {
          gateway: promotion.paymentMethod,
          pesapalTrackingId: promotion.pesapalTrackingId,
          dgatewayReference: promotion.dgatewayReference,
          yoReference: promotion.yoReference,
          merchantReference: promotion.transactionId,
        });

        if (gatewayStatus?.status === 'completed') {
          promotion = await activatePromotion(strapi, promotion);
        } else if (gatewayStatus?.status === 'failed') {
          await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', promotion.id, {
            data: { status: 'cancelled' },
          });
          promotion = { ...promotion, status: 'cancelled' };
        }
      } catch (err) {
        strapi.log.warn(`Promotion status verify failed for ${transactionId}: ${err.message}`);
      }
    }

    return { data: promotion };
  },

  async adminRevenue(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');
    if (!isAdminUser(ctx.state.user)) return ctx.forbidden('Only admins can view promotion revenue');

    const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
      filters: { status: { $in: ['active', 'expired'] } },
      populate: { seller: { fields: ['id', 'username', 'email'] }, product: true },
      sort: { createdAt: 'desc' },
      limit: 200,
    });

    const totalRevenue = (promotions || []).reduce((sum, promotion) => sum + Number(promotion.amount || 0), 0);
    return {
      data: {
        totalRevenue,
        count: promotions?.length || 0,
        promotions: promotions || [],
      },
    };
  },

  async activate(ctx) {
    if (!ctx.state.user || !isAdminUser(ctx.state.user)) return ctx.forbidden('Only admins can activate promotions');
    const promotion = await strapi.entityService.findOne('api::marketplace-promotion.marketplace-promotion', ctx.params.id, {
      populate: { product: true, seller: true },
    });
    if (!promotion) return ctx.notFound('Promotion not found');
    return { data: await activatePromotion(strapi, promotion) };
  },
}));
