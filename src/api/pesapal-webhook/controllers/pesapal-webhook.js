'use strict';

const pesapal = require('../../../utils/pesapal');
const { normalizePaymentMethod } = require('../../../utils/payment-methods');
const { recordProviderMaterialSale } = require('../../../utils/provider-material-sales');
const { activatePromotionByFilter, failPromotionByFilter } = require('../../../utils/marketplace-promotions');
const { notifyProductOrderPlaced } = require('../../../utils/marketplace-notifications');

module.exports = {
  /**
   * Pesapal IPN (Instant Payment Notification) handler.
   * Called by Pesapal when a payment status changes.
   * The IPN sends: OrderTrackingId, OrderNotificationType, OrderMerchantReference
   */
  async ipn(ctx) {
    const {
      OrderTrackingId,
      OrderNotificationType,
      OrderMerchantReference,
    } = ctx.query;

    strapi.log.info(`[Pesapal IPN] Received: trackingId=${OrderTrackingId}, type=${OrderNotificationType}, ref=${OrderMerchantReference}`);

    if (!OrderTrackingId) {
      ctx.body = { orderNotificationType: 'IPNCHANGE', orderTrackingId: OrderTrackingId, orderMerchantReference: OrderMerchantReference, status: 200 };
      return;
    }

    try {
      // Get the full transaction status from Pesapal
      const status = await pesapal.getTransactionStatus(OrderTrackingId);
      strapi.log.info(`[Pesapal IPN] Transaction status:`, JSON.stringify(status));

      const paymentStatus = (status.payment_status_description || '').toLowerCase();
      const confirmationCode = status.confirmation_code || '';
      const paymentMethod = normalizePaymentMethod(status.payment_method, 'pesapal');

      if (paymentStatus === 'completed') {
        // Check if this is a subscription (SUB_) or purchase (PUR_ / CART_)
        const ref = OrderMerchantReference || status.merchant_reference || '';

        if (ref.startsWith('SUB_')) {
          // Activate the subscription
          const subs = await strapi.entityService.findMany('api::subscription.subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });

          if (subs && subs.length > 0) {
            const sub = subs[0];
            if (sub.status !== 'active') {
              await strapi.entityService.update('api::subscription.subscription', sub.id, {
                data: {
                  status: 'active',
                  pesapalTrackingId: OrderTrackingId,
                  ...(paymentMethod ? { paymentMethod } : {}),
                },
              });
              strapi.log.info(`[Pesapal IPN] Subscription ${sub.id} activated for ref ${ref}, method: ${paymentMethod}`);
            }
          }
        } else if (ref.startsWith('EXCL_')) {
          // Activate exclusive subscription
          const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });

          if (exclSubs && exclSubs.length > 0) {
            const exclSub = exclSubs[0];
            if (exclSub.status !== 'active') {
              await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
                data: {
                  status: 'active',
                  pesapalTrackingId: OrderTrackingId,
                  ...(paymentMethod ? { paymentMethod } : {}),
                },
              });
              strapi.log.info(`[Pesapal IPN] Exclusive subscription ${exclSub.id} activated for ref ${ref}, method: ${paymentMethod}`);
            }
          }
        } else if (ref.startsWith('PROMO_')) {
          await activatePromotionByFilter(strapi, { transactionId: ref }, paymentMethod);
          strapi.log.info(`[Pesapal IPN] Marketplace promotion activated for ref ${ref}`);
        } else {
          // Purchase(s) — could be single (PUR_) or cart (CART_)
          const purchases = await strapi.db.query('api::purchase.purchase').findMany({
            where: { transactionId: ref },
            populate: {
              buyer: true,
              providerMaterial: true,
              product: { populate: { seller: true } },
            },
          });

          for (const purchase of purchases) {
            if (purchase.status !== 'completed') {
              if (purchase.providerMaterial) {
                await recordProviderMaterialSale(strapi, purchase);
              }
              await strapi.db.query('api::purchase.purchase').update({
                where: { id: purchase.id },
                data: {
                  status: 'completed',
                  pesapalTrackingId: OrderTrackingId,
                  ...(paymentMethod ? { paymentMethod } : {}),
                },
              });
              if (purchase.product) {
                await notifyProductOrderPlaced(strapi, {
                  ...purchase,
                  status: 'completed',
                  pesapalTrackingId: OrderTrackingId,
                  ...(paymentMethod ? { paymentMethod } : {}),
                }, { statusLabel: 'Payment completed' });
              }
              strapi.log.info(`[Pesapal IPN] Purchase ${purchase.id} completed for ref ${ref}, method: ${paymentMethod}`);
            }
          }
        }
      } else if (paymentStatus === 'failed' || paymentStatus === 'invalid') {
        const ref = OrderMerchantReference || status.merchant_reference || '';

        if (ref.startsWith('SUB_')) {
          const subs = await strapi.entityService.findMany('api::subscription.subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });
          for (const sub of subs) {
            if (sub.status === 'pending') {
              await strapi.entityService.update('api::subscription.subscription', sub.id, {
                data: { status: 'cancelled' },
              });
            }
          }
        } else if (ref.startsWith('EXCL_')) {
          const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });
          for (const exclSub of exclSubs) {
            if (exclSub.status === 'pending') {
              await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
                data: { status: 'cancelled' },
              });
            }
          }
        } else if (ref.startsWith('PROMO_')) {
          await failPromotionByFilter(strapi, { transactionId: ref });
        } else {
          const purchases = await strapi.db.query('api::purchase.purchase').findMany({
            where: { transactionId: ref },
          });
          for (const purchase of purchases) {
            if (purchase.status === 'pending') {
              await strapi.db.query('api::purchase.purchase').update({
                where: { id: purchase.id },
                data: { status: 'failed' },
              });
            }
          }
        }
      }

      // Respond to Pesapal with acknowledgment
      ctx.body = {
        orderNotificationType: OrderNotificationType,
        orderTrackingId: OrderTrackingId,
        orderMerchantReference: OrderMerchantReference,
        status: 200,
      };
    } catch (err) {
      strapi.log.error('[Pesapal IPN] Error processing:', err);
      ctx.body = {
        orderNotificationType: OrderNotificationType,
        orderTrackingId: OrderTrackingId,
        orderMerchantReference: OrderMerchantReference,
        status: 500,
      };
    }
  },

  /**
   * Verify payment status — called by frontend after redirect back from Pesapal.
   * The frontend sends the OrderTrackingId to check if payment is complete.
   */
  async verify(ctx) {
    const { orderTrackingId } = ctx.query;

    if (!orderTrackingId) {
      return ctx.badRequest('Missing orderTrackingId');
    }

    try {
      const status = await pesapal.getTransactionStatus(orderTrackingId);
      const paymentStatus = (status.payment_status_description || '').toLowerCase();
      const ref = status.merchant_reference || '';
      let actualPaymentMethod = null;

      // Determine the purchase type and gather context for the frontend
      let purchaseType = 'unknown';
      let movieInfo = null;
      let itemInfo = null;

      if (paymentStatus === 'completed') {
        actualPaymentMethod = normalizePaymentMethod(status.payment_method, 'pesapal');

        if (ref.startsWith('SUB_')) {
          purchaseType = 'subscription';
          const subs = await strapi.entityService.findMany('api::subscription.subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });
          if (subs && subs.length > 0 && subs[0].status !== 'active') {
            await strapi.entityService.update('api::subscription.subscription', subs[0].id, {
              data: { status: 'active', pesapalTrackingId: orderTrackingId, ...(actualPaymentMethod ? { paymentMethod: actualPaymentMethod } : {}) },
            });
          }
        } else if (ref.startsWith('EXCL_')) {
          purchaseType = 'exclusive';
          const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
            filters: { transactionId: ref },
            limit: 1,
          });
          if (exclSubs && exclSubs.length > 0 && exclSubs[0].status !== 'active') {
            await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSubs[0].id, {
              data: { status: 'active', pesapalTrackingId: orderTrackingId, ...(actualPaymentMethod ? { paymentMethod: actualPaymentMethod } : {}) },
            });
          }
        } else {
          purchaseType = 'purchase';
          const purchases = await strapi.db.query('api::purchase.purchase').findMany({
            where: { transactionId: ref },
            populate: {
              movie: true,
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
                data: { status: 'completed', pesapalTrackingId: orderTrackingId, ...(actualPaymentMethod ? { paymentMethod: actualPaymentMethod } : {}) },
              });
              if (p.product) {
                await notifyProductOrderPlaced(strapi, {
                  ...p,
                  status: 'completed',
                  pesapalTrackingId: orderTrackingId,
                  ...(actualPaymentMethod ? { paymentMethod: actualPaymentMethod } : {}),
                }, { statusLabel: 'Payment completed' });
              }
            }
          }
          // Return movie info so frontend can link directly to the content
          if (purchases.length === 1 && purchases[0].movie) {
            const m = purchases[0].movie;
            movieInfo = { id: m.documentId || m.id, title: m.title, type: m.type };
            itemInfo = { kind: 'movie', id: m.documentId || m.id, title: m.title, type: m.type };
          } else if (purchases.length === 1 && purchases[0].providerMaterial) {
            const material = purchases[0].providerMaterial;
            itemInfo = { kind: 'provider_material', id: material.documentId || material.id, title: material.title, type: material.mediaType };
          } else if (purchases.length > 1) {
            purchaseType = 'bulk_purchase';
          }
        }
      } else {
        // Still determine type from reference even if not completed
        if (ref.startsWith('SUB_')) purchaseType = 'subscription';
        else if (ref.startsWith('EXCL_')) purchaseType = 'exclusive';
        else if (ref.startsWith('PUR_')) purchaseType = 'purchase';
        else if (ref.startsWith('BULK_')) purchaseType = 'bulk_purchase';
      }

      return {
        data: {
          status: paymentStatus,
          merchantReference: ref,
          confirmationCode: status.confirmation_code || '',
          amount: status.amount,
          paymentMethod: actualPaymentMethod,
          rawPaymentMethod: status.payment_method || '',
          purchaseType,
          movieInfo,
          itemInfo,
        },
      };
    } catch (err) {
      strapi.log.error('[Pesapal Verify] Error:', err);
      return ctx.badRequest('Failed to verify payment status');
    }
  },
};
