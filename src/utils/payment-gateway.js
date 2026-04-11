'use strict';

/**
 * Payment Gateway Abstraction Layer
 *
 * Delegates to either Pesapal or DGateway based on site settings.
 * Provides a unified interface for all payment operations.
 */

const pesapal = require('./pesapal');
const dgateway = require('./dgateway');

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

  if (gateway === 'dgateway') {
    const result = await dgateway.collectPayment({
      amount: params.amount,
      currency: 'UGX',
      phone_number: params.paymentPhone || params.billingAddress?.phone || '',
      provider: 'iotec',
      description: params.description,
      metadata: {
        merchant_reference: params.merchantReference,
      },
    });

    return {
      gateway: 'dgateway',
      reference: result.data?.reference,
      status: result.data?.status,
    };
  }

  // Default: Pesapal
  const pesapalOrder = await pesapal.submitOrder({
    merchantReference: params.merchantReference,
    amount: params.amount,
    description: params.description,
    callbackUrl: params.callbackUrl,
    ipnId: params.ipnId,
    billingAddress: params.billingAddress,
  });

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

  if (gateway === 'dgateway' && params.dgatewayReference) {
    const result = await dgateway.verifyTransaction(params.dgatewayReference);
    const dgStatus = (result.data?.status || '').toLowerCase();

    let normalizedStatus = 'pending';
    if (dgStatus === 'completed' || dgStatus === 'successful') normalizedStatus = 'completed';
    else if (dgStatus === 'failed') normalizedStatus = 'failed';

    return {
      status: normalizedStatus,
      paymentMethod: result.data?.provider || 'dgateway',
      failureReason: result.data?.failure_reason || '',
      raw: result.data,
    };
  }

  if (params.pesapalTrackingId) {
    const status = await pesapal.getTransactionStatus(params.pesapalTrackingId);
    const paymentStatus = (status.payment_status_description || '').toLowerCase();

    let normalizedStatus = 'pending';
    if (paymentStatus === 'completed') normalizedStatus = 'completed';
    else if (paymentStatus === 'failed' || paymentStatus === 'invalid') normalizedStatus = 'failed';

    return {
      status: normalizedStatus,
      paymentMethod: status.payment_method || 'pesapal',
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
};
