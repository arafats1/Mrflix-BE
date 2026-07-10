'use strict';

/**
 * Airtel Collection-APIs response codes (Uganda developer documentation).
 * https://developers.airtel.ug/documentation/collection-apis/error-codes
 *
 * Disbursement-APIs response codes:
 * https://developers.airtel.ug/documentation/disbursement-apis/error-codes
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
  DP00900001000: {
    reason: 'Ambiguous',
    description: 'The transaction is still processing and is in ambiguous state. Please do the transaction enquiry to fetch the transaction status.',
  },
  DP00900001001: {
    reason: 'Success',
    description: 'Transaction is successful.',
  },
  DP00900001003: {
    reason: 'Maximum transaction limit reached',
    description: 'Maximum transaction limit reached for the day.',
  },
  DP00900001004: {
    reason: 'Invalid Amount',
    description: 'Amount entered is out of range with respect to defined limits.',
  },
  DP00900001005: {
    reason: 'Failed',
    description: 'Transaction failed.',
  },
  DP00900001006: {
    reason: 'Processing',
    description: 'Transaction is in process.',
  },
  DP00900001007: {
    reason: 'Insufficient Funds',
    description: 'Not enough funds in account to complete the transaction.',
  },
  DP00900001009: {
    reason: 'Invalid Initiatee',
    description: 'Initiatee of the transaction is invalid.',
  },
  DP00900001010: {
    reason: 'User not allowed',
    description: 'Payer is not an allowed user.',
  },
  DP00900001011: {
    reason: 'Transaction not allowed',
    description: 'Transaction with similar information already exists in this system.',
  },
  DP00900001012: {
    reason: 'Invalid mobile number',
    description: 'Mobile number entered is incorrect.',
  },
  DP00900001013: {
    reason: 'Refused',
    description: 'The transaction was refused.',
  },
  DP00900001014: {
    reason: 'Transaction Timed Out',
    description: 'The transaction may be processed or failed due to time out. To know the exact status please do the transaction enquiry.',
  },
  DP00900001015: {
    reason: 'Transaction Not Found',
    description: 'The transaction was not found.',
  },
  DP00900001016: {
    reason: 'Forbidden',
    description: 'X-signature and payload did not match.',
  },
  DP00900001017: {
    reason: 'Duplicate transaction Id',
    description: 'Duplicate Transaction Id. To know the status of the actual transaction, please do transaction enquiry.',
  },
};

/** Router / gateway codes returned outside the standard status envelope */
const ROUTER_RESPONSE_CODES = {
  ROUTER116: {
    reason: 'PIN decryption failed',
    description: 'Airtel could not decrypt the disbursement PIN. Check the 4-digit merchant PIN or use the pre-encrypted PIN from Airtel.',
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
  ...ROUTER_RESPONSE_CODES,
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

/** Codes that mean the transaction is still processing (keep polling). */
const PENDING_RESPONSE_CODES = new Set([
  'DP00800001000', // Ambiguous
  'DP00800001006', // In process
  'DP00900001000', // Ambiguous
  'DP00900001006', // Processing
]);

/** Codes that mean a successful final state. */
const SUCCESS_RESPONSE_CODES = new Set([
  'DP00800001001',
  'DP00900001001',
  'DP02200000001',
]);

/**
 * Classify an Airtel status string or response_code into completed|failed|pending.
 * Accepts TS/TF, SUCCESS/FAILED, TIP/TA, and documented DP008/DP009 codes.
 */
function classifyAirtelStatus(statusOrCode) {
  const code = String(statusOrCode || '').trim().toUpperCase();
  if (!code) return 'pending';

  if (
    code === 'TS'
    || code === 'SUCCESS'
    || code === 'SUCCESSFUL'
    || code === 'SUCCEEDED'
    || SUCCESS_RESPONSE_CODES.has(code)
  ) {
    return 'completed';
  }

  if (
    code === 'TIP'
    || code === 'TA'
    || code === '250'
    || code === 'IN PROCESS'
    || code === 'PROCESSING'
    || code === 'AMBIGUOUS'
    || PENDING_RESPONSE_CODES.has(code)
  ) {
    return 'pending';
  }

  if (
    code === 'TF'
    || code === 'TE'
    || code === 'FAILED'
    || code === 'FAILURE'
    || code === 'EXPIRED'
    || code === 'TIMED OUT'
    || code === 'TIMEOUT'
  ) {
    return 'failed';
  }

  // Any other documented DP00x / ROUTER code is a terminal failure
  // (incorrect pin, over limit, insufficient balance, refused, etc.).
  if (ALL_RESPONSE_CODES[code] && !PENDING_RESPONSE_CODES.has(code) && !SUCCESS_RESPONSE_CODES.has(code)) {
    return 'failed';
  }

  // Unknown DP00* response codes that are not pending/success → treat as failed
  if (/^DP00\d{9}$/.test(code) || /^ROUTER\d+$/.test(code)) {
    return 'failed';
  }

  return 'pending';
}

module.exports = {
  describeAirtelResponseCode,
  getAirtelResponseCodeMeta,
  classifyAirtelStatus,
  PENDING_RESPONSE_CODES,
  SUCCESS_RESPONSE_CODES,
  COLLECTION_RESPONSE_CODES,
  DISBURSEMENT_RESPONSE_CODES,
  KYC_RESPONSE_CODES,
  ROUTER_RESPONSE_CODES,
  ALL_RESPONSE_CODES,
};
