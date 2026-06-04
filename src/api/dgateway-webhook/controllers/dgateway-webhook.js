'use strict';

const { normalizePaymentMethod } = require('../../../utils/payment-methods');
const { recordProviderMaterialSale } = require('../../../utils/provider-material-sales');
const { activatePromotionByFilter, failPromotionByFilter } = require('../../../utils/marketplace-promotions');
const { notifyProductOrderPlaced } = require('../../../utils/marketplace-notifications');
const { activateHomesPaymentByFilter, failHomesPaymentByFilter } = require('../../../utils/homes-payments');

const crypto = require('crypto');
const dgateway = require('../../../utils/dgateway');

module.exports = {
  /**
   * DGateway Webhook handler.
   * Called by DGateway when a payment status changes.
   */
  async webhook(ctx) {
    const rawBody = typeof ctx.request.body === 'string'
      ? ctx.request.body
      : JSON.stringify(ctx.request.body);

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.DGATEWAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const signature = ctx.request.headers['x-dgateway-signature'];
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      if (signature !== `sha256=${expected}`) {
        strapi.log.warn('[DGateway Webhook] Invalid signature');
        ctx.status = 401;
        ctx.body = { error: 'Invalid signature' };
        return;
      }
    }

    const event = typeof ctx.request.body === 'string'
      ? JSON.parse(ctx.request.body)
      : ctx.request.body;

    const { reference, status, amount, currency } = event;

    strapi.log.info(`[DGateway Webhook] Received: reference=${reference}, status=${status}, amount=${amount}`);

    if (!reference) {
      ctx.body = { status: 'received' };
      return;
    }

    const paymentStatus = (status || '').toLowerCase();

    if (paymentStatus === 'completed' || paymentStatus === 'successful') {
      // Find records by dgatewayReference
      await activateByReference(reference, 'dgateway');
    } else if (paymentStatus === 'failed') {
      await failByReference(reference);
    }

    ctx.body = { status: 'received' };
  },

  /**
   * Verify DGateway payment status — called by frontend for polling.
   */
  async verify(ctx) {
    const { reference } = ctx.request.body || ctx.query;

    if (!reference) {
      return ctx.badRequest('Missing reference');
    }

    try {
      const result = await dgateway.verifyTransaction(reference);
      strapi.log.info(`[DGateway Verify] ref=${reference}, response=${JSON.stringify(result).substring(0, 500)}`);

      // DGateway may return an error object instead of data
      if (result.error) {
        strapi.log.warn(`[DGateway Verify] API error for ${reference}: ${result.error.message || result.error.code}`);
        // Return pending so frontend keeps polling
        return {
          data: {
            status: 'pending',
            reference,
            errorDetail: result.error.message || 'Verification pending',
          },
        };
      }

      const dgStatus = (result.data?.status || '').toLowerCase();

      let normalizedStatus = 'pending';
      if (dgStatus === 'completed' || dgStatus === 'successful') normalizedStatus = 'completed';
      else if (dgStatus === 'failed') normalizedStatus = 'failed';

      // If completed, auto-activate records
      if (normalizedStatus === 'completed') {
        try {
          await activateByReference(reference, 'dgateway');
        } catch (activateErr) {
          strapi.log.error(`[DGateway Verify] activateByReference failed for ${reference}:`, activateErr?.message || activateErr, activateErr?.stack);
        }
      }

      // Determine purchase type from records
      let purchaseType = 'unknown';
      let movieInfo = null;

      // Check purchases
      try {
      const purchases = await strapi.db.query('api::purchase.purchase').findMany({
        where: { dgatewayReference: reference },
        populate: ['movie'],
      });
      if (purchases.length > 0) {
        purchaseType = purchases.length > 1 ? 'bulk_purchase' : 'purchase';
        if (purchases.length === 1 && purchases[0].movie) {
          const m = purchases[0].movie;
          movieInfo = { id: m.documentId || m.id, title: m.title, type: m.type };
        }
      }
      } catch (dbErr) {
        strapi.log.error(`[DGateway Verify] Purchase query failed:`, dbErr?.message || dbErr);
      }

      // Check subscriptions
      if (purchaseType === 'unknown') {
        try {
        const subs = await strapi.entityService.findMany('api::subscription.subscription', {
          filters: { dgatewayReference: reference },
          limit: 1,
        });
        if (subs && subs.length > 0) purchaseType = 'subscription';
        } catch (dbErr) {
          strapi.log.error(`[DGateway Verify] Subscription query failed:`, dbErr?.message || dbErr);
        }
      }

      // Check exclusive subscriptions
      if (purchaseType === 'unknown') {
        try {
        const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
          filters: { dgatewayReference: reference },
          limit: 1,
        });
        if (exclSubs && exclSubs.length > 0) purchaseType = 'exclusive';
        } catch (dbErr) {
          strapi.log.error(`[DGateway Verify] Exclusive sub query failed:`, dbErr?.message || dbErr);
        }
      }

      if (purchaseType === 'unknown') {
        try {
          const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
            filters: { dgatewayReference: reference },
            limit: 1,
          });
          if (promotions && promotions.length > 0) purchaseType = 'marketplace_promotion';
        } catch (dbErr) {
          strapi.log.error(`[DGateway Verify] Promotion query failed:`, dbErr?.message || dbErr);
        }
      }

          if (purchaseType === 'unknown') {
            const homesUnlocks = await strapi.entityService.findMany('api::home-contact-unlock.home-contact-unlock', { filters: { dgatewayReference: reference }, limit: 1 }).catch(() => []);
            const homesBookings = await strapi.entityService.findMany('api::home-booking.home-booking', { filters: { dgatewayReference: reference }, limit: 1 }).catch(() => []);
            if ((homesUnlocks && homesUnlocks.length > 0) || (homesBookings && homesBookings.length > 0)) purchaseType = 'homes';
          }

      return {
        data: {
          status: normalizedStatus,
          reference,
          amount: result.data?.amount,
          paymentMethod: normalizePaymentMethod(result.data?.provider, 'dgateway'),
          rawPaymentMethod: result.data?.provider || '',
          failureReason: result.data?.failure_reason || '',
          purchaseType,
          movieInfo,
        },
      };
    } catch (err) {
      strapi.log.error(`[DGateway Verify] Error for ${reference}:`, err && err.stack ? err.stack : JSON.stringify(err));
      // Return pending instead of 400 so frontend keeps polling
      return {
        data: {
          status: 'pending',
          reference,
          errorDetail: err.message || 'Verification temporarily unavailable',
        },
      };
    }
  },
};

/**
 * Activate records (purchase/subscription/exclusive) by DGateway reference.
 */
async function activateByReference(reference, paymentMethod) {
  // Purchases
  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { dgatewayReference: reference },
    populate: {
      providerMaterial: true,
      buyer: true,
      product: { populate: { seller: true } },
    },
  });
  for (const p of purchases) {
    if (p.status !== 'completed') {
      if (p.providerMaterial) {
        await recordProviderMaterialSale(strapi, p);
      }
      await strapi.db.query('api::purchase.purchase').update({
        where: { id: p.id },
        data: {
          status: 'completed',
          ...(paymentMethod ? { paymentMethod } : {}),
        },
      });
      if (p.product) {
        await notifyProductOrderPlaced(strapi, {
          ...p,
          status: 'completed',
          ...(paymentMethod ? { paymentMethod } : {}),
        }, { statusLabel: 'Payment completed' });
      }
      strapi.log.info(`[DGateway Webhook] Purchase ${p.id} completed for ref ${reference}`);
    }
  }

  // Subscriptions
  const subs = await strapi.entityService.findMany('api::subscription.subscription', {
    filters: { dgatewayReference: reference },
    limit: 1,
  });
  for (const sub of (subs || [])) {
    if (sub.status !== 'active') {
      await strapi.entityService.update('api::subscription.subscription', sub.id, {
        data: {
          status: 'active',
          ...(paymentMethod ? { paymentMethod } : {}),
        },
      });
      strapi.log.info(`[DGateway Webhook] Subscription ${sub.id} activated for ref ${reference}`);
    }
  }

  // Exclusive subscriptions
  const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
    filters: { dgatewayReference: reference },
    limit: 1,
  });
  for (const exclSub of (exclSubs || [])) {
    if (exclSub.status !== 'active') {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
        data: {
          status: 'active',
          ...(paymentMethod ? { paymentMethod } : {}),
        },
      });
      strapi.log.info(`[DGateway Webhook] Exclusive subscription ${exclSub.id} activated for ref ${reference}`);
    }
  }

  await activatePromotionByFilter(strapi, { dgatewayReference: reference }, paymentMethod);
  await activateHomesPaymentByFilter(strapi, { dgatewayReference: reference }, paymentMethod);
}

/**
 * Mark records as failed by DGateway reference.
 */
async function failByReference(reference) {
  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { dgatewayReference: reference },
  });
  for (const p of purchases) {
    if (p.status === 'pending') {
      await strapi.db.query('api::purchase.purchase').update({
        where: { id: p.id },
        data: { status: 'failed' },
      });
    }
  }

  const subs = await strapi.entityService.findMany('api::subscription.subscription', {
    filters: { dgatewayReference: reference },
    limit: 1,
  });
  for (const sub of (subs || [])) {
    if (sub.status === 'pending') {
      await strapi.entityService.update('api::subscription.subscription', sub.id, {
        data: { status: 'cancelled' },
      });
    }
  }

  const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
    filters: { dgatewayReference: reference },
    limit: 1,
  });
  for (const exclSub of (exclSubs || [])) {
    if (exclSub.status === 'pending') {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
        data: { status: 'cancelled' },
      });
    }
  }

  await failPromotionByFilter(strapi, { dgatewayReference: reference });
  await failHomesPaymentByFilter(strapi, { dgatewayReference: reference });
}
