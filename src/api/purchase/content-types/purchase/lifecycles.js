'use strict';

const { applySavingsDepositPurchase, SAVINGS_TRANSACTION_PREFIX } = require('../../../../utils/savings');

/**
 * Purchase lifecycle.
 *
 * When a savings-deposit purchase (transactionId starts with `SAV_`) transitions
 * to `status: 'completed'`, automatically credit the linked child profile's
 * piggy bank using the same allocation rules used for the parent UI.
 *
 * This is idempotent — `applySavingsDepositPurchase` flips a flag on the
 * purchase row so repeat completion events (multiple webhook deliveries,
 * polling races) cannot double-credit a child.
 */
module.exports = {
  async afterUpdate(event) {
    try {
      const result = event?.result;
      if (!result?.id) return;
      if (result.status !== 'completed') return;
      const txn = String(result.transactionId || '');
      if (!txn.startsWith(SAVINGS_TRANSACTION_PREFIX)) return;
      if (result.savingsDepositApplied) return;

      const fresh = await strapi.db.query('api::purchase.purchase').findOne({
        where: { id: result.id },
        populate: { childProfile: { select: ['id'] } },
      });
      if (!fresh) return;
      await applySavingsDepositPurchase(strapi, fresh);
    } catch (err) {
      strapi.log.error('[purchase lifecycle] savings deposit apply failed:', err);
    }
  },
};
