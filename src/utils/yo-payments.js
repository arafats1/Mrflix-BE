'use strict';

/**
 * Yo! Payments Integration Utility
 *
 * Spec: Yo! Payments API v3.49 (XML-based).
 * Endpoint: https://paymentsapi1.yo.co.ug/ybs/task.php
 *
 * Implemented operations:
 *   - acdepositfunds (PULL deposit – mobile money collection)
 *   - actransactioncheckstatus (poll status)
 *
 * Required env vars:
 *   - YO_API_USERNAME
 *   - YO_API_PASSWORD
 *   - YO_API_URL (optional, defaults to production)
 */

const API_URL = process.env.YO_API_URL || 'https://paymentsapi1.yo.co.ug/ybs/task.php';
const API_USERNAME = process.env.YO_API_USERNAME;
const API_PASSWORD = process.env.YO_API_PASSWORD;

function escapeXml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Tiny single-tag XML extractor.
 * Sufficient for Yo!'s flat response payloads.
 */
function extractTag(xml, tag) {
  if (!xml) return '';
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return match ? match[1].trim() : '';
}

function buildRequestXml(method, params) {
  const fields = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<AutoCreate>
  <Request>
    <APIUsername>${escapeXml(API_USERNAME)}</APIUsername>
    <APIPassword>${escapeXml(API_PASSWORD)}</APIPassword>
    <Method>${escapeXml(method)}</Method>
${fields}
  </Request>
</AutoCreate>`;
}

async function yoCall(method, params) {
  if (!API_USERNAME || !API_PASSWORD) {
    throw new Error('YO_API_USERNAME / YO_API_PASSWORD environment variables are not set');
  }

  const body = buildRequestXml(method, params);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'Content-transfer-encoding': 'text',
    },
    body,
  });

  const text = await res.text();

  const status = extractTag(text, 'Status');
  const statusCode = extractTag(text, 'StatusCode');
  const statusMessage = extractTag(text, 'StatusMessage');
  const errorMessage = extractTag(text, 'ErrorMessage');
  const transactionStatus = extractTag(text, 'TransactionStatus');
  const transactionReference = extractTag(text, 'TransactionReference');

  if (status !== 'OK') {
    const err = new Error(errorMessage || statusMessage || 'Yo! Payments request failed');
    err.code = 'YO_PAYMENTS_ERROR';
    err.statusCode = statusCode;
    err.transactionStatus = transactionStatus;
    err.rawXml = text;
    throw err;
  }

  return {
    status,
    statusCode,
    transactionStatus,
    transactionReference,
    raw: text,
  };
}

/**
 * Initiate a mobile-money pull-deposit.
 * Returns a transactionReference that the frontend can poll.
 *
 * @param {object} params
 * @param {number|string} params.amount
 * @param {string} params.account – MSISDN with country code, e.g. "256771234567"
 * @param {string} params.narrative – description shown to subscriber
 * @param {string} [params.externalReference] – your own merchant reference
 * @param {string} [params.providerReferenceText]
 * @param {string} [params.instantNotificationUrl]
 * @param {string} [params.failureNotificationUrl]
 */
async function requestDeposit({
  amount,
  account,
  narrative,
  externalReference,
  providerReferenceText,
  instantNotificationUrl,
  failureNotificationUrl,
}) {
  return yoCall('acdepositfunds', {
    NonBlocking: 'TRUE',
    Amount: amount,
    Account: account,
    Narrative: narrative,
    ExternalReference: externalReference,
    ProviderReferenceText: providerReferenceText,
    InstantNotificationUrl: instantNotificationUrl,
    FailureNotificationUrl: failureNotificationUrl,
  });
}

/**
 * Check the status of a previously initiated Yo! Payments transaction.
 *
 * @param {object} params
 * @param {string} [params.transactionReference]
 * @param {string} [params.privateTransactionReference] – your externalReference
 */
async function checkStatus({ transactionReference, privateTransactionReference }) {
  return yoCall('actransactioncheckstatus', {
    TransactionReference: transactionReference,
    PrivateTransactionReference: privateTransactionReference,
    DepositTransactionType: 'PULL',
  });
}

module.exports = {
  requestDeposit,
  checkStatus,
};
