'use strict';

/**
 * Airtel Collection-APIs response codes (Uganda developer documentation).
 * https://developers.airtel.ug/documentation/collection-apis/error-codes
 */

const COLLECTION_RESPONSE_CODES = {
  DP00800001000: {
    reason: 'Ambiguous',
    description: 'The transaction is still processing and is in ambiguous state. Please do the transaction enquiry to fetch the transaction status.',
  },
  DP00800001001: {
    reason: 'Success',
    description: 'Transaction is successful.',
  },
  DP00800001002: {
    reason: 'Incorrect Pin',
    description: 'Incorrect pin has been entered.',
  },
  DP00800001003: {
    reason: 'Exceeds withdrawal amount limit(s)',
    description: 'The user has exceeded their wallet allowed transaction limit.',
  },
  DP00800001004: {
    reason: 'Invalid Amount',
    description: 'The amount the user is trying to transfer is less than the minimum amount allowed.',
  },
  DP00800001005: {
    reason: 'Transaction ID is invalid',
    description: 'User did not enter the pin.',
  },
  DP00800001006: {
    reason: 'In process',
    description: 'Transaction in pending state. Please check after sometime.',
  },
  DP00800001007: {
    reason: 'Not enough balance',
    description: 'User wallet does not have enough money to cover the payable amount.',
  },
  DP00800001008: {
    reason: 'Refused',
    description: 'The transaction was refused.',
  },
  DP00800001009: {
    reason: 'Do not honor',
    description: 'This is a generic refusal that has several possible causes.',
  },
  DP00800001010: {
    reason: 'Transaction not permitted to Payee',
    description: 'Payee is already initiated for churn or barred or not registered on Airtel Money platform.',
  },
  DP00800001024: {
    reason: 'Transaction Timed Out',
    description: 'The transaction was timed out.',
  },
  DP00800001025: {
    reason: 'Transaction Not Found',
    description: 'The transaction was not found.',
  },
  DP00800001026: {
    reason: 'Forbidden',
    description: 'X-signature and payload did not match.',
  },
  DP00800001029: {
    reason: 'Transaction Expired',
    description: 'Transaction has been expired.',
  },
};

const DISBURSEMENT_RESPONSE_CODES = {
  DP00900001001: {
    reason: 'Success',
    description: 'Transaction is successful.',
  },
  DP00900001016: {
    reason: 'Forbidden',
    description: 'X-signature and payload did not match.',
  },
};

const KYC_RESPONSE_CODES = {
  DP02200000000: {
    reason: 'Failed',
    description: 'User enquiry is failed.',
  },
  DP02200000001: {
    reason: 'Success',
    description: 'User enquiry is successful.',
  },
  DP02200000002: {
    reason: 'User Not Found',
    description: 'Invalid MSISDN provided as input.',
  },
};

const ALL_RESPONSE_CODES = {
  ...COLLECTION_RESPONSE_CODES,
  ...DISBURSEMENT_RESPONSE_CODES,
  ...KYC_RESPONSE_CODES,
};

function getAirtelResponseCodeMeta(code) {
  const key = String(code || '').trim();
  if (!key) return null;
  return ALL_RESPONSE_CODES[key] || null;
}

function describeAirtelResponseCode(code) {
  const meta = getAirtelResponseCodeMeta(code);
  if (!meta) return null;
  return `${meta.reason} — ${meta.description}`;
}

module.exports = {
  describeAirtelResponseCode,
  getAirtelResponseCodeMeta,
  COLLECTION_RESPONSE_CODES,
  DISBURSEMENT_RESPONSE_CODES,
  KYC_RESPONSE_CODES,
  ALL_RESPONSE_CODES,
};
