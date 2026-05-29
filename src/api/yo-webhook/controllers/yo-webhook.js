'use strict';

const yoPayments = require('../../../utils/yo-payments');
const { normalizePaymentMethod } = require('../../../utils/payment-methods');
const { recordProviderMaterialSale } = require('../../../utils/provider-material-sales');
const { notifyProductOrderPlaced } = require('../../../utils/marketplace-notifications');

/**
 * Activate purchases / subscriptions tagged with the given Yo! reference.
 */
async function activateByReference(reference, paymentMethod = 'yo') {
  // Match either the Yo transaction reference OR the privateTransactionReference
  // we sent as ExternalReference (which we previously stored as merchantReference).
  const match = (where) => ({
    $or: [
      { yoReference: reference },
      // ExternalReference fallback: some flows store the merchantRef in dgatewayReference
      // when the gateway was switched mid-flight. We only match yoReference here to keep
      // gateway boundaries clean.
    ],
    ...where,
  });

  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { yoReference: reference },
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
        data: { status: 'completed', paymentMethod },
      });
      if (p.product) {
        await notifyProductOrderPlaced(strapi, {
          ...p,
          status: 'completed',
          paymentMethod,
        }, { statusLabel: 'Payment completed' });
      }
      strapi.log.info(`[Yo Webhook] Purchase ${p.id} completed for ref ${reference}`);
    }
  }

  const subs = await strapi.entityService.findMany('api::subscription.subscription', {
    filters: { yoReference: reference },
    limit: 1,
  });
  for (const sub of (subs || [])) {
    if (sub.status !== 'active') {
      await strapi.entityService.update('api::subscription.subscription', sub.id, {
        data: { status: 'active', paymentMethod },
      });
      strapi.log.info(`[Yo Webhook] Subscription ${sub.id} activated for ref ${reference}`);
    }
  }

  const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
    filters: { yoReference: reference },
    limit: 1,
  });
  for (const exclSub of (exclSubs || [])) {
    if (exclSub.status !== 'active') {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
        data: { status: 'active', paymentMethod },
      });
      strapi.log.info(`[Yo Webhook] Exclusive subscription ${exclSub.id} activated for ref ${reference}`);
    }
  }
}

async function failByReference(reference) {
  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { yoReference: reference },
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
    filters: { yoReference: reference },
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
    filters: { yoReference: reference },
    limit: 1,
  });
  for (const exclSub of (exclSubs || [])) {
    if (exclSub.status === 'pending') {
      await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
        data: { status: 'cancelled' },
      });
    }
  }
}

module.exports = {
  /**
   * Yo! Payments Instant Payment Notification (IPN).
   * Form-encoded POST with: date_time, amount, narrative, network_ref,
   * external_ref, msisdn, payer_names, payer_email, signature.
   */
  async webhook(ctx) {
    const body = ctx.request.body || {};
    const externalRef = body.external_ref;
    const networkRef = body.network_ref;

    strapi.log.info(`[Yo Webhook] IPN received: external_ref=${externalRef}, network_ref=${networkRef}, amount=${body.amount}`);

    // Yo IPN means the deposit succeeded.
    if (externalRef) {
      // Look up the transaction reference via status check using our merchantReference
      try {
        const result = await yoPayments.checkStatus({ privateTransactionReference: externalRef });
        if (result.transactionReference) {
          await activateByReference(result.transactionReference);
        }
      } catch (err) {
        strapi.log.warn(`[Yo Webhook] Failed to resolve tx for external_ref=${externalRef}: ${err.message}`);
      }
    }

    ctx.status = 200;
    ctx.body = { status: 'received' };
  },

  /**
   * Yo! Payments Transaction Failure Notification.
   * Form-encoded POST with: failed_transaction_reference, transaction_init_date, verification.
   */
  async failure(ctx) {
    const body = ctx.request.body || {};
    const ref = body.failed_transaction_reference;

    strapi.log.info(`[Yo Webhook] Failure notification: ref=${ref}`);

    if (ref) {
      await failByReference(ref);
    }

    ctx.status = 200;
    ctx.body = { status: 'received' };
  },

  /**
   * Frontend polling endpoint — checks status with Yo! and activates records on success.
   */
  async verify(ctx) {
    const { reference, merchantReference } = ctx.request.body || ctx.query || {};

    if (!reference && !merchantReference) {
      return ctx.badRequest('Missing reference or merchantReference');
    }

    try {
      const result = await yoPayments.checkStatus({
        transactionReference: reference,
        privateTransactionReference: merchantReference,
      });

      const txStatus = (result.transactionStatus || '').toUpperCase();
      let normalizedStatus = 'pending';
      if (txStatus === 'SUCCEEDED') normalizedStatus = 'completed';
      else if (txStatus === 'FAILED') normalizedStatus = 'failed';

      const txRef = result.transactionReference || reference;

      if (normalizedStatus === 'completed' && txRef) {
        await activateByReference(txRef);
      } else if (normalizedStatus === 'failed' && txRef) {
        await failByReference(txRef);
      }

      // Determine purchase type
      let purchaseType = 'unknown';
      let movieInfo = null;

      if (txRef) {
        const purchases = await strapi.db.query('api::purchase.purchase').findMany({
          where: { yoReference: txRef },
          populate: ['movie'],
        });
        if (purchases.length > 0) {
          purchaseType = purchases.length > 1 ? 'bulk_purchase' : 'purchase';
          if (purchases.length === 1 && purchases[0].movie) {
            const m = purchases[0].movie;
            movieInfo = { id: m.documentId || m.id, title: m.title, type: m.type };
          }
        }

        if (purchaseType === 'unknown') {
          const subs = await strapi.entityService.findMany('api::subscription.subscription', {
            filters: { yoReference: txRef },
            limit: 1,
          });
          if (subs && subs.length > 0) purchaseType = 'subscription';
        }

        if (purchaseType === 'unknown') {
          const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
            filters: { yoReference: txRef },
            limit: 1,
          });
          if (exclSubs && exclSubs.length > 0) purchaseType = 'exclusive';
        }
      }

      return {
        data: {
          status: normalizedStatus,
          reference: txRef,
          paymentMethod: 'yo',
          purchaseType,
          movieInfo,
        },
      };
    } catch (err) {
      strapi.log.warn(`[Yo Verify] Error: ${err.message}`);
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
