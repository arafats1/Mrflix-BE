'use strict';

const airtel = require('../../../utils/airtel');
const { verifyCallbackHash } = require('../../../utils/airtel-crypto');
const { getUatCases, DEFAULT_UAT_NUMBERS, MSISDN_KEY_LABELS } = require('../../../utils/airtel-uat-cases');
const { runUatCase, runCustomAction } = require('../../../utils/airtel-uat-runner');
const {
  activateByMerchantReference,
  failByMerchantReference,
} = require('../../../utils/airtel-payment-handlers');
const { resolveUserWithRole, isAdminUser } = require('../../../utils/admin-auth');
const { recordAirtelCallback, listAirtelCallbacks } = require('../../../utils/airtel-callback-log');

function getCallbackHmacSecret() {
  return String(process.env.AIRTEL_CALLBACK_HMAC_SECRET || process.env.AIRTEL_CLIENT_SECRET || '').trim();
}

function requireCallbackHash() {
  return String(process.env.AIRTEL_CALLBACK_REQUIRE_HASH || '').trim().toLowerCase() === 'true';
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        defaultTestNumbers: DEFAULT_UAT_NUMBERS,
        testNumberLabels: MSISDN_KEY_LABELS,
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

    const { caseId, overrides, testNumbers, pin, encryptedPin, signDisbursement } = ctx.request.body || {};
    if (!caseId) {
      return ctx.badRequest('Missing caseId');
    }

    const mergedOverrides = { ...(overrides || {}) };
    if (pin) mergedOverrides.pin = pin;
    if (encryptedPin) mergedOverrides.encryptedPin = encryptedPin;
    if (signDisbursement === true) mergedOverrides.signRequest = true;
    if (signDisbursement === false) mergedOverrides.signRequest = false;

    const result = await runUatCase(caseId, mergedOverrides, testNumbers || {});
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
   * List recent Airtel callback payloads received by this server (UAT debugging).
   */
  async uatCallbacks(ctx) {
    if (!(await assertUatAccess(ctx))) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const transactionId = String(ctx.query.transactionId || '').trim() || null;
    const limit = Number(ctx.query.limit) || 50;

    ctx.body = {
      data: {
        callbackUrl: process.env.PUBLIC_URL ? airtel.getCallbackUrl() : null,
        collectionsCallbackUrl: process.env.PUBLIC_URL ? airtel.getCollectionsCallbackUrl() : null,
        callbacks: listAirtelCallbacks({ transactionId, limit }),
      },
    };
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
      recordAirtelCallback({
        payload,
        error: 'Ignored — missing transaction.id in callback body',
      });
      ctx.status = 200;
      ctx.body = { status: 'ignored' };
      return;
    }

    const { merchantReference, statusCode, airtelMoneyId, normalizedStatus } = callbackTx;

    try {
      let finalStatus = normalizedStatus;
      let finalAirtelMoneyId = airtelMoneyId;
      let verifiedStatusCode = null;

      if (process.env.AIRTEL_VERIFY_CALLBACKS !== 'false') {
        try {
          const verified = await airtel.getTransactionStatus(merchantReference);
          finalStatus = verified.status;
          finalAirtelMoneyId = verified.airtelMoneyId || airtelMoneyId;
          verifiedStatusCode = verified.statusCode || null;
          strapi.log.info(
            `[Airtel Callback] Verified ${merchantReference}: callback=${statusCode}, api=${verified.statusCode}, status=${finalStatus}`
          );
        } catch (verifyErr) {
          strapi.log.warn(
            `[Airtel Callback] Status verification failed for ${merchantReference}, using callback status ${statusCode}: ${verifyErr.message}`
          );
        }
      }

      recordAirtelCallback({
        payload,
        merchantReference,
        statusCode,
        airtelMoneyId: finalAirtelMoneyId,
        normalizedStatus,
        verifiedStatus: finalStatus,
        verifiedStatusCode,
      });

      await processAirtelStatus(strapi, merchantReference, finalStatus, finalAirtelMoneyId);

      ctx.status = 200;
      ctx.body = { status: 'received', transactionId: merchantReference };
    } catch (err) {
      recordAirtelCallback({
        payload,
        merchantReference,
        statusCode,
        airtelMoneyId,
        normalizedStatus,
        error: err.message || 'Callback processing failed',
      });
      strapi.log.error('[Airtel Callback] Error processing:', err);
      ctx.status = 200;
      ctx.body = { status: 'error', transactionId: merchantReference };
    }
  },

  /**
   * Fresh Airtel Collections callback (docs: Callback With/Without Authentication).
   *
   * Without auth:
   *   { transaction: { id, message, status_code, airtel_money_id } }
   *
   * With auth:
   *   { transaction: { ... }, hash: "<HMAC-SHA256 base64>" }
   *
   * Register in Airtel portal: {PUBLIC_URL}/api/airtel/collections/callback
   */
  async collectionsCallback(ctx) {
    if (ctx.request.method !== 'POST') {
      ctx.status = 405;
      ctx.body = { error: 'Method not allowed' };
      return;
    }

    const payload = parseCallbackBody(ctx);
    const contentType = String(ctx.request.headers['content-type'] || '');
    const hasHash = Boolean(payload?.hash);
    const hmacSecret = getCallbackHmacSecret();
    const mustVerifyHash = requireCallbackHash() || hasHash;

    strapi.log.info(
      `[Airtel Collections Callback] Received content-type=${contentType || 'n/a'} hasHash=${hasHash}: ${JSON.stringify(payload || {}).substring(0, 500)}`
    );

    if (mustVerifyHash) {
      if (!hmacSecret) {
        recordAirtelCallback({
          payload,
          error: 'Rejected — callback hash present/required but AIRTEL_CLIENT_SECRET is not configured',
        });
        ctx.status = 401;
        ctx.body = { status: 'unauthorized', error: 'Callback HMAC secret not configured' };
        return;
      }

      if (!verifyCallbackHash(payload, hmacSecret)) {
        recordAirtelCallback({
          payload,
          error: 'Rejected — invalid callback hash (DP00800001026 style mismatch)',
        });
        strapi.log.warn('[Airtel Collections Callback] Invalid hash — rejecting');
        ctx.status = 401;
        ctx.body = { status: 'unauthorized', error: 'Invalid callback hash' };
        return;
      }
    }

    const callbackTx = extractCallbackTransaction(payload);

    if (!callbackTx) {
      recordAirtelCallback({
        payload,
        error: 'Ignored — missing transaction.id in collections callback body',
      });
      // Still 200 so Airtel does not keep retrying a malformed payload forever.
      ctx.status = 200;
      ctx.body = { status: 'ignored', reason: 'missing transaction.id' };
      return;
    }

    const { merchantReference, statusCode, airtelMoneyId, message, normalizedStatus } = callbackTx;

    try {
      let finalStatus = normalizedStatus;
      let finalAirtelMoneyId = airtelMoneyId;
      let verifiedStatusCode = null;

      if (process.env.AIRTEL_VERIFY_CALLBACKS !== 'false') {
        try {
          const verified = await airtel.getTransactionStatus(merchantReference);
          finalStatus = verified.status;
          finalAirtelMoneyId = verified.airtelMoneyId || airtelMoneyId;
          verifiedStatusCode = verified.statusCode || null;
          strapi.log.info(
            `[Airtel Collections Callback] Verified ${merchantReference}: callback=${statusCode}, api=${verified.statusCode}, status=${finalStatus}`
          );
        } catch (verifyErr) {
          strapi.log.warn(
            `[Airtel Collections Callback] Status verification failed for ${merchantReference}, using callback status ${statusCode}: ${verifyErr.message}`
          );
        }
      }

      recordAirtelCallback({
        payload,
        merchantReference,
        statusCode,
        airtelMoneyId: finalAirtelMoneyId,
        normalizedStatus,
        verifiedStatus: finalStatus,
        verifiedStatusCode,
      });

      await processAirtelStatus(strapi, merchantReference, finalStatus, finalAirtelMoneyId);

      ctx.status = 200;
      ctx.body = {
        status: 'received',
        transactionId: merchantReference,
        airtelMoneyId: finalAirtelMoneyId || null,
        statusCode,
        message: message || null,
        hashVerified: mustVerifyHash,
      };
    } catch (err) {
      recordAirtelCallback({
        payload,
        merchantReference,
        statusCode,
        airtelMoneyId,
        normalizedStatus,
        error: err.message || 'Collections callback processing failed',
      });
      strapi.log.error('[Airtel Collections Callback] Error processing:', err);
      // Acknowledge receipt so Airtel does not hammer retries; activation can be recovered via /airtel/verify.
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
      const pollDelaysMs = [0, 2000, 3000, 5000];
      let result = null;
      let pollAttempts = 0;

      for (const delay of pollDelaysMs) {
        if (delay > 0) {
          await sleep(delay);
        }

        result = await airtel.getTransactionStatus(transactionId);
        pollAttempts += 1;

        if (result.status === 'completed' || result.status === 'failed') {
          break;
        }
      }

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
          polled: pollAttempts > 1,
          pollAttempts,
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
