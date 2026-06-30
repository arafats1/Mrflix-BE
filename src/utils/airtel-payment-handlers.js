'use strict';

const { recordProviderMaterialSale } = require('./provider-material-sales');
const { activatePromotionByFilter, failPromotionByFilter } = require('./marketplace-promotions');
const { notifyProductOrderPlaced } = require('./marketplace-notifications');
const { activateHomesPaymentByFilter, failHomesPaymentByFilter } = require('./homes-payments');

const PAYMENT_METHOD = 'airtel_money';

function buildAirtelUpdateData(airtelMoneyId) {
  return {
    paymentMethod: PAYMENT_METHOD,
    ...(airtelMoneyId ? { airtelReference: airtelMoneyId } : {}),
  };
}

/**
 * Activate purchases, subscriptions, promotions, and homes payments by merchant reference.
 */
async function activateByMerchantReference(strapi, merchantReference, airtelMoneyId = '') {
  const updateData = buildAirtelUpdateData(airtelMoneyId);
  const ref = merchantReference;

  if (ref.startsWith('SUB')) {
    const subs = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: { transactionId: ref },
      limit: 1,
    });

    for (const sub of subs || []) {
      if (sub.status !== 'active') {
        await strapi.entityService.update('api::subscription.subscription', sub.id, {
          data: { status: 'active', ...updateData },
        });
        strapi.log.info(`[Airtel] Subscription ${sub.id} activated for ref ${ref}`);
      }
    }
    return;
  }

  if (ref.startsWith('EXCL')) {
    const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: { transactionId: ref },
      limit: 1,
    });

    for (const exclSub of exclSubs || []) {
      if (exclSub.status !== 'active') {
        await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
          data: { status: 'active', ...updateData },
        });
        strapi.log.info(`[Airtel] Exclusive subscription ${exclSub.id} activated for ref ${ref}`);
      }
    }
    return;
  }

  if (ref.startsWith('PROMO')) {
    await activatePromotionByFilter(strapi, { transactionId: ref }, PAYMENT_METHOD);
    if (airtelMoneyId) {
      const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
        filters: { transactionId: ref },
        limit: 10,
      });
      for (const promotion of promotions || []) {
        await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', promotion.id, {
          data: { airtelReference: airtelMoneyId },
        });
      }
    }
    strapi.log.info(`[Airtel] Marketplace promotion activated for ref ${ref}`);
    return;
  }

  if (ref.startsWith('HCU') || ref.startsWith('HBOOK')) {
    await activateHomesPaymentByFilter(strapi, { transactionId: ref }, PAYMENT_METHOD);
    if (airtelMoneyId) {
      const unlocks = await strapi.entityService.findMany('api::home-contact-unlock.home-contact-unlock', {
        filters: { transactionId: ref },
        limit: 10,
      });
      for (const unlock of unlocks || []) {
        await strapi.entityService.update('api::home-contact-unlock.home-contact-unlock', unlock.id, {
          data: { airtelReference: airtelMoneyId },
        });
      }

      const bookings = await strapi.entityService.findMany('api::home-booking.home-booking', {
        filters: { transactionId: ref },
        limit: 10,
      });
      for (const booking of bookings || []) {
        await strapi.entityService.update('api::home-booking.home-booking', booking.id, {
          data: { airtelReference: airtelMoneyId },
        });
      }
    }
    strapi.log.info(`[Airtel] Homes payment activated for ref ${ref}`);
    return;
  }

  const purchases = await strapi.db.query('api::purchase.purchase').findMany({
    where: { transactionId: ref },
    populate: {
      providerMaterial: true,
      buyer: true,
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
          ...updateData,
        },
      });

      if (purchase.product) {
        await notifyProductOrderPlaced(strapi, {
          ...purchase,
          status: 'completed',
          ...updateData,
        }, { statusLabel: 'Payment completed' });
      }

      strapi.log.info(`[Airtel] Purchase ${purchase.id} completed for ref ${ref}`);
    }
  }

  const storageSubs = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
    filters: { transactionId: ref },
    limit: 1,
  });

  for (const storageSub of storageSubs || []) {
    if (storageSub.status !== 'active') {
      await strapi.entityService.update('api::storage-subscription.storage-subscription', storageSub.id, {
        data: { status: 'active', ...updateData },
      });
      strapi.log.info(`[Airtel] Storage subscription ${storageSub.id} activated for ref ${ref}`);
    }
  }
}

/**
 * Mark pending records as failed/cancelled by merchant reference.
 */
async function failByMerchantReference(strapi, merchantReference) {
  const ref = merchantReference;

  if (ref.startsWith('SUB')) {
    const subs = await strapi.entityService.findMany('api::subscription.subscription', {
      filters: { transactionId: ref },
      limit: 1,
    });
    for (const sub of subs || []) {
      if (sub.status === 'pending') {
        await strapi.entityService.update('api::subscription.subscription', sub.id, {
          data: { status: 'cancelled' },
        });
      }
    }
    return;
  }

  if (ref.startsWith('EXCL')) {
    const exclSubs = await strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
      filters: { transactionId: ref },
      limit: 1,
    });
    for (const exclSub of exclSubs || []) {
      if (exclSub.status === 'pending') {
        await strapi.entityService.update('api::exclusive-subscription.exclusive-subscription', exclSub.id, {
          data: { status: 'cancelled' },
        });
      }
    }
    return;
  }

  if (ref.startsWith('PROMO')) {
    await failPromotionByFilter(strapi, { transactionId: ref });
    return;
  }

  if (ref.startsWith('HCU') || ref.startsWith('HBOOK')) {
    await failHomesPaymentByFilter(strapi, { transactionId: ref });
    return;
  }

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

  const storageSubs = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
    filters: { transactionId: ref },
    limit: 1,
  });

  for (const storageSub of storageSubs || []) {
    if (storageSub.status === 'pending') {
      await strapi.entityService.update('api::storage-subscription.storage-subscription', storageSub.id, {
        data: { status: 'cancelled' },
      });
    }
  }
}

module.exports = {
  activateByMerchantReference,
  failByMerchantReference,
};
