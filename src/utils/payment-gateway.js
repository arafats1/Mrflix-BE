'use strict';

/**
 * Payment Gateway Abstraction Layer
 *
 * Delegates to either Pesapal or DGateway based on site settings.
 * Provides a unified interface for all payment operations.
 */

const pesapal = require('./pesapal');
const dgateway = require('./dgateway');
const yoPayments = require('./yo-payments');
const airtel = require('./airtel');
const { normalizePaymentMethod } = require('./payment-methods');

function gatewayNeedsPhone(gateway) {
  return gateway === 'dgateway' || gateway === 'yo' || gateway === 'airtel';
}

function buildGatewayTrackingUpdate(paymentResult) {
  const updateData = {};

  if (paymentResult.gateway === 'pesapal') {
    updateData.pesapalTrackingId = paymentResult.order_tracking_id;
  } else if (paymentResult.gateway === 'dgateway') {
    updateData.dgatewayReference = paymentResult.reference;
  } else if (paymentResult.gateway === 'yo') {
    updateData.yoReference = paymentResult.reference;
  }

  return updateData;
}

function resolveRecordGateway(record = {}) {
  if (record.yoReference) return 'yo';
  if (record.dgatewayReference) return 'dgateway';
  if (record.pesapalTrackingId) return 'pesapal';
  if (record.paymentMethod === 'airtel' || record.paymentMethod === 'airtel_money') return 'airtel';
  return 'pesapal';
}

function recordHasGatewayTracking(record = {}) {
  return Boolean(
    record.pesapalTrackingId
    || record.dgatewayReference
    || record.yoReference
    || record.paymentMethod === 'airtel'
    || record.paymentMethod === 'airtel_money'
    || record.transactionId
  );
}

function getPesapalIpnCallbackUrl() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL is required to register Pesapal IPN callbacks.');
  }

  return new URL('/api/pesapal/ipn', process.env.PUBLIC_URL).toString();
}

async function refreshPesapalIpnId(strapi) {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

  if (!settings?.id) {
    throw new Error('Site settings are required before refreshing the Pesapal IPN ID.');
  }

  const ipnId = await pesapal.registerIPN(getPesapalIpnCallbackUrl());

  await strapi.entityService.update('api::site-setting.site-setting', settings.id, {
    data: { pesapalIpnId: ipnId },
  });

  if (strapi?.log?.info) {
    strapi.log.info(`[Pesapal] Registered a fresh IPN ID for the current credentials: ${ipnId}`);
  }

  return ipnId;
}

/**
 * Get the active payment gateway name from site settings.
 * @param {object} strapi – strapi instance
 * @returns {Promise<string>} 'pesapal' or 'dgateway'
 */
async function getActiveGateway(strapi) {
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  return settings?.paymentGateway || 'pesapal';
}

/**
 * Submit a payment order through the active gateway.
 *
 * For Pesapal: submits order and returns { redirect_url, order_tracking_id }
 * For DGateway: collects payment (phone prompt) and returns { reference, status }
 *
 * @param {object} strapi – strapi instance
 * @param {object} params
 * @param {string} params.merchantReference – unique order/transaction ID
 * @param {number} params.amount – amount in UGX
 * @param {string} params.description – what the user is paying for
 * @param {string} params.callbackUrl – URL for Pesapal redirect
 * @param {string} params.ipnId – Pesapal IPN ID
 * @param {object} params.billingAddress – { email, phone, firstName, lastName }
 * @param {string} [params.paymentPhone] – phone number for DGateway
 * @returns {{ gateway, redirect_url?, order_tracking_id?, reference?, status? }}
 */
async function submitPayment(strapi, params) {
  const gateway = await getActiveGateway(strapi);

  if (gateway === 'airtel') {
    const phone = (params.paymentPhone || params.billingAddress?.phone || '').replace(/[^\d]/g, '');
    if (!phone) {
      throw new Error('Phone number is required for Airtel Money');
    }

    await airtel.requestCollection({
      merchantReference: params.merchantReference,
      amount: params.amount,
      phone,
      reference: params.description,
    });

    return {
      gateway: 'airtel',
      reference: params.merchantReference,
      status: 'pending',
    };
  }

  if (gateway === 'yo') {
    const phone = (params.paymentPhone || params.billingAddress?.phone || '').replace(/[^\d]/g, '');
    if (!phone) {
      throw new Error('Phone number is required for Yo! Payments');
    }
    const account = phone.startsWith('0') ? `256${phone.slice(1)}` : phone;

    const result = await yoPayments.requestDeposit({
      amount: params.amount,
      account,
      narrative: params.description || 'Mr.Flix payment',
      externalReference: params.merchantReference,
      instantNotificationUrl: process.env.YO_IPN_URL || undefined,
      failureNotificationUrl: process.env.YO_FAILURE_URL || undefined,
    });

    return {
      gateway: 'yo',
      reference: result.transactionReference,
      status: (result.transactionStatus || 'PENDING').toLowerCase(),
    };
  }

  if (gateway === 'dgateway') {
    let result;

    try {
      result = await dgateway.collectPayment({
        amount: params.amount,
        currency: 'UGX',
        phone_number: params.paymentPhone || params.billingAddress?.phone || '',
        provider: 'iotec',
        description: params.description,
        metadata: {
          merchant_reference: params.merchantReference,
        },
      });
    } catch (error) {
      const ambiguousGatewayFailure =
        error?.code === 'DGATEWAY_NON_JSON_RESPONSE' ||
        error?.status >= 500;

      if (!ambiguousGatewayFailure) {
        throw error;
      }

      const recoveredTransaction = await dgateway.findTransactionByMerchantReference(
        params.merchantReference,
        { perPage: 50, status: 'all' }
      ).catch(() => null);

      if (!recoveredTransaction?.reference) {
        throw error;
      }

      result = {
        data: {
          reference: recoveredTransaction.reference,
          status: recoveredTransaction.status || 'pending',
          provider: recoveredTransaction.provider || recoveredTransaction.provider_slug || 'iotec',
        },
      };

      if (strapi?.log?.warn) {
        strapi.log.warn(
          `[DGateway] Recovered collect request for ${params.merchantReference} from recent transactions after upstream ${error?.status || 'unknown'} response.`
        );
      }
    }

    return {
      gateway: 'dgateway',
      reference: result.data?.reference,
      status: result.data?.status,
    };
  }

  // Default: Pesapal
  const submitPesapalOrder = (ipnId) => pesapal.submitOrder({
    merchantReference: params.merchantReference,
    amount: params.amount,
    description: params.description,
    callbackUrl: params.callbackUrl,
    ipnId,
    billingAddress: params.billingAddress,
  });

  let pesapalOrder;

  try {
    pesapalOrder = await submitPesapalOrder(params.ipnId);
  } catch (error) {
    const invalidIpnId = error?.code === 'InvalidIpnId' || /invalid ipn id/i.test(error?.message || '');

    if (!invalidIpnId) {
      throw error;
    }

    if (strapi?.log?.warn) {
      strapi.log.warn('[Pesapal] Stored IPN ID was rejected for the current credentials. Registering a fresh IPN ID and retrying order submission.');
    }

    const refreshedIpnId = await refreshPesapalIpnId(strapi);
    pesapalOrder = await submitPesapalOrder(refreshedIpnId);
  }

  return {
    gateway: 'pesapal',
    redirect_url: pesapalOrder.redirect_url,
    order_tracking_id: pesapalOrder.order_tracking_id,
  };
}

/**
 * Check the status of a payment through the active gateway.
 *
 * @param {object} strapi – strapi instance
 * @param {object} params
 * @param {string} [params.pesapalTrackingId] – Pesapal order tracking ID
 * @param {string} [params.dgatewayReference] – DGateway transaction reference
 * @param {string} [params.gateway] – force a specific gateway (optional)
 * @returns {{ status: 'completed'|'pending'|'failed', paymentMethod?, raw? }}
 */
async function checkPaymentStatus(strapi, params) {
  const gateway = params.gateway || await getActiveGateway(strapi);

  if (gateway === 'yo' && (params.yoReference || params.merchantReference)) {
    const result = await yoPayments.checkStatus({
      transactionReference: params.yoReference,
      privateTransactionReference: params.merchantReference,
    });

    const txStatus = (result.transactionStatus || '').toUpperCase();
    let normalizedStatus = 'pending';
    if (txStatus === 'SUCCEEDED') normalizedStatus = 'completed';
    else if (txStatus === 'FAILED') normalizedStatus = 'failed';

    return {
      status: normalizedStatus,
      paymentMethod: 'yo',
      raw: result,
    };
  }

  if (gateway === 'airtel' && params.merchantReference) {
    const result = await airtel.getTransactionStatus(params.merchantReference);

    return {
      status: result.status,
      paymentMethod: 'airtel_money',
      confirmationCode: result.airtelMoneyId || '',
      raw: result.raw,
    };
  }

  if (gateway === 'dgateway' && params.dgatewayReference) {
    const result = await dgateway.verifyTransaction(params.dgatewayReference);
    const dgStatus = (result.data?.status || '').toLowerCase();

    let normalizedStatus = 'pending';
    if (dgStatus === 'completed' || dgStatus === 'successful') normalizedStatus = 'completed';
    else if (dgStatus === 'failed') normalizedStatus = 'failed';

    return {
      status: normalizedStatus,
      paymentMethod: normalizePaymentMethod(result.data?.provider, 'dgateway'),
      failureReason: result.data?.failure_reason || '',
      raw: result.data,
    };
  }

  if (params.pesapalTrackingId) {
    const status = await pesapal.getTransactionStatus(params.pesapalTrackingId);
    const paymentStatus = (status.payment_status_description || '').toLowerCase();

    let normalizedStatus = 'pending';
    if (paymentStatus === 'completed') normalizedStatus = 'completed';
    // Unpaid or in-progress Pesapal orders can report "invalid" — only explicit
    // failures should cancel a pending checkout during status polling.
    else if (paymentStatus === 'failed') normalizedStatus = 'failed';

    return {
      status: normalizedStatus,
      paymentMethod: normalizePaymentMethod(status.payment_method, 'pesapal'),
      confirmationCode: status.confirmation_code || '',
      raw: status,
    };
  }

  return { status: 'pending' };
}

module.exports = {
  getActiveGateway,
  submitPayment,
  checkPaymentStatus,
  gatewayNeedsPhone,
  buildGatewayTrackingUpdate,
  resolveRecordGateway,
  recordHasGatewayTracking,
};
