'use strict';

const airtel = require('../../../utils/airtel');
const { getUatCases } = require('../../../utils/airtel-uat-cases');
const { runUatCase, runCustomAction } = require('../../../utils/airtel-uat-runner');
const {
  activateByMerchantReference,
  failByMerchantReference,
} = require('../../../utils/airtel-payment-handlers');
const { resolveUserWithRole, isAdminUser } = require('../../../utils/admin-auth');

async function assertUatAccess(ctx) {
  const expectedToken = String(process.env.AIRTEL_UAT_TOKEN || '').trim();
  const providedToken = String(ctx.query.token || ctx.request.body?.token || '').trim();

  if (expectedToken && providedToken === expectedToken) {
    return true;
  }

  const user = await resolveUserWithRole(strapi, ctx);
  return isAdminUser(user);
}

function parseCallbackBody(ctx) {
  if (typeof ctx.request.body === 'string') {
    try {
      return JSON.parse(ctx.request.body);
    } catch {
      return null;
    }
  }

  return ctx.request.body || null;
}

function extractCallbackTransaction(payload) {
  const transaction = payload?.transaction;
  if (!transaction || typeof transaction !== 'object') {
    return null;
  }

  const merchantReference = transaction.id || transaction.transaction_id || '';
  const statusCode = transaction.status_code || transaction.status || '';
  const airtelMoneyId = transaction.airtel_money_id || '';

  if (!merchantReference) {
    return null;
  }

  return {
    merchantReference,
    statusCode,
    airtelMoneyId,
    message: transaction.message || '',
    normalizedStatus: airtel.normalizeAirtelStatus(statusCode),
  };
}

async function processAirtelStatus(strapi, merchantReference, normalizedStatus, airtelMoneyId) {
  if (normalizedStatus === 'completed') {
    await activateByMerchantReference(strapi, merchantReference, airtelMoneyId);
    return;
  }

  if (normalizedStatus === 'failed') {
    await failByMerchantReference(strapi, merchantReference);
  }
}

module.exports = {
  /**
   * Safe Airtel config/auth diagnostic for Railway debugging.
   * Optional: set AIRTEL_CONFIG_CHECK_TOKEN and pass ?token=...
   */
  async configCheck(ctx) {
    const expectedToken = String(process.env.AIRTEL_CONFIG_CHECK_TOKEN || '').trim();
    const providedToken = String(ctx.query.token || '').trim();

    if (expectedToken && providedToken !== expectedToken) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const result = await airtel.testConnection();
    ctx.body = { data: result };
  },

  /**
   * List predefined Airtel UAT test cases.
   */
  async uatCases(ctx) {
    if (!(await assertUatAccess(ctx))) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const group = String(ctx.query.group || '').trim() || null;
    const config = await airtel.testConnection();

    ctx.body = {
      data: {
        config,
        cases: getUatCases(group),
      },
    };
  },

  /**
   * Run one predefined UAT case by id.
   */
  async uatRunCase(ctx) {
    if (!(await assertUatAccess(ctx))) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { caseId, overrides } = ctx.request.body || {};
    if (!caseId) {
      return ctx.badRequest('Missing caseId');
    }

    const result = await runUatCase(caseId, overrides || {});
    ctx.body = { data: result };
  },

  /**
   * Run a custom Airtel UAT action.
   */
  async uatRunAction(ctx) {
    if (!(await assertUatAccess(ctx))) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { action, params } = ctx.request.body || {};
    if (!action) {
      return ctx.badRequest('Missing action');
    }

    const result = await runCustomAction(action, params || {});
    ctx.body = { data: result };
  },

  /**
   * Airtel Collections callback handler.
   * Airtel POSTs: { transaction: { id, status_code, airtel_money_id, message } }
   */
  async callback(ctx) {
    if (ctx.request.method !== 'POST') {
      ctx.status = 405;
      ctx.body = { error: 'Method not allowed' };
      return;
    }

    const payload = parseCallbackBody(ctx);
    const callbackTx = extractCallbackTransaction(payload);

    strapi.log.info(`[Airtel Callback] Received: ${JSON.stringify(payload || {}).substring(0, 500)}`);

    if (!callbackTx) {
      ctx.status = 200;
      ctx.body = { status: 'ignored' };
      return;
    }

    const { merchantReference, statusCode, airtelMoneyId, normalizedStatus } = callbackTx;

    try {
      let finalStatus = normalizedStatus;
      let finalAirtelMoneyId = airtelMoneyId;

      if (process.env.AIRTEL_VERIFY_CALLBACKS !== 'false') {
        try {
          const verified = await airtel.getTransactionStatus(merchantReference);
          finalStatus = verified.status;
          finalAirtelMoneyId = verified.airtelMoneyId || airtelMoneyId;
          strapi.log.info(
            `[Airtel Callback] Verified ${merchantReference}: callback=${statusCode}, api=${verified.statusCode}, status=${finalStatus}`
          );
        } catch (verifyErr) {
          strapi.log.warn(
            `[Airtel Callback] Status verification failed for ${merchantReference}, using callback status ${statusCode}: ${verifyErr.message}`
          );
        }
      }

      await processAirtelStatus(strapi, merchantReference, finalStatus, finalAirtelMoneyId);

      ctx.status = 200;
      ctx.body = { status: 'received', transactionId: merchantReference };
    } catch (err) {
      strapi.log.error('[Airtel Callback] Error processing:', err);
      ctx.status = 200;
      ctx.body = { status: 'error', transactionId: merchantReference };
    }
  },

  /**
   * Verify Airtel payment status — called by frontend for polling.
   */
  async verify(ctx) {
    const { transactionId } = ctx.request.body || ctx.query;

    if (!transactionId) {
      return ctx.badRequest('Missing transactionId');
    }

    try {
      const result = await airtel.getTransactionStatus(transactionId);

      if (result.status === 'completed') {
        try {
          await activateByMerchantReference(strapi, transactionId, result.airtelMoneyId);
        } catch (activateErr) {
          strapi.log.error(`[Airtel Verify] activateByMerchantReference failed for ${transactionId}:`, activateErr?.message || activateErr);
        }
      } else if (result.status === 'failed') {
        try {
          await failByMerchantReference(strapi, transactionId);
        } catch (failErr) {
          strapi.log.error(`[Airtel Verify] failByMerchantReference failed for ${transactionId}:`, failErr?.message || failErr);
        }
      }

      let purchaseType = 'unknown';
      let movieInfo = null;
      let itemInfo = null;

      const ref = transactionId;

      if (ref.startsWith('SUB')) {
        purchaseType = 'subscription';
      } else if (ref.startsWith('EXCL')) {
        purchaseType = 'exclusive';
      } else if (ref.startsWith('PROMO')) {
        purchaseType = 'marketplace_promotion';
      } else if (ref.startsWith('HCU') || ref.startsWith('HBOOK')) {
        purchaseType = 'homes';
      } else {
        const purchases = await strapi.db.query('api::purchase.purchase').findMany({
          where: { transactionId: ref },
          populate: ['movie', 'providerMaterial'],
        });

        if (purchases.length > 1) {
          purchaseType = 'bulk_purchase';
        } else if (purchases.length === 1) {
          purchaseType = 'purchase';
          const purchase = purchases[0];

          if (purchase.movie) {
            const movie = purchase.movie;
            movieInfo = { id: movie.documentId || movie.id, title: movie.title, type: movie.type };
            itemInfo = { kind: 'movie', id: movie.documentId || movie.id, title: movie.title, type: movie.type };
          } else if (purchase.providerMaterial) {
            const material = purchase.providerMaterial;
            itemInfo = {
              kind: 'provider_material',
              id: material.documentId || material.id,
              title: material.title,
              type: material.mediaType,
            };
          }
        }
      }

      return {
        data: {
          status: result.status,
          merchantReference: transactionId,
          airtelMoneyId: result.airtelMoneyId,
          message: result.message,
          statusCode: result.statusCode,
          paymentMethod: 'airtel_money',
          purchaseType,
          movieInfo,
          itemInfo,
        },
      };
    } catch (err) {
      strapi.log.error(`[Airtel Verify] Error for ${transactionId}:`, err?.message || err);
      return {
        data: {
          status: 'pending',
          merchantReference: transactionId,
          errorDetail: err.message || 'Verification temporarily unavailable',
        },
      };
    }
  },
};
