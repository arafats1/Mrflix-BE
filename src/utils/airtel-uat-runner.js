'use strict';

const airtel = require('./airtel');
const { getUatCase, resolveCaseMsisdn } = require('./airtel-uat-cases');
const { describeAirtelResponseCode, getAirtelResponseCodeMeta } = require('./airtel-response-codes');

function readEnv(name) {
  return String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

function buildReference(prefix, caseIdValue) {
  return airtel.buildAirtelReference(prefix, [caseIdValue || 'custom']);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDisbursementTransactionType(params = {}) {
  return params.transactionType || readEnv('AIRTEL_DISBURSEMENT_TRANSACTION_TYPE') || 'B2C';
}

const PENDING_DISBURSEMENT_CODES = new Set(['DP00900001000', 'DP00900001006']);
const PENDING_DISBURSEMENT_STATUSES = new Set(['250', 'TIP', 'TA', 'IN PROCESS', 'PROCESSING']);

function isPendingDisbursement(summary) {
  if (!summary) return false;

  const status = String(summary.transactionStatus || summary.statusCode || '').toUpperCase();
  return PENDING_DISBURSEMENT_CODES.has(summary.responseCode)
    || PENDING_DISBURSEMENT_STATUSES.has(status);
}

function isTerminalDisbursement(summary) {
  if (!summary) return false;
  if (summary.responseCode === 'DP00900001001') return true;

  const status = String(summary.transactionStatus || summary.statusCode || '').toUpperCase();
  if (['TS', 'SUCCESS', 'SUCCESSFUL', 'TF', 'FAILED', 'FAILURE'].includes(status)) {
    return true;
  }

  if (summary.responseCode && !isPendingDisbursement(summary)) {
    return true;
  }

  return false;
}

async function pollDisbursementStatus(transactionId, transactionType) {
  const delaysMs = [2000, 3000, 5000, 5000, 8000];
  const attempts = [];

  for (let i = 0; i < delaysMs.length; i += 1) {
    await sleep(delaysMs[i]);
    const result = await airtel.invokeDisbursementStatus(transactionId, transactionType);
    const response = summarizeResponse(result);
    attempts.push({
      attempt: i + 1,
      polledAt: new Date().toISOString(),
      response,
      raw: result.raw,
    });

    if (isTerminalDisbursement(response)) {
      break;
    }
  }

  return attempts;
}

function summarizeResponse(result) {
  const status = result?.data?.status || result?.raw?.status || {};
  const transaction = result?.data?.transaction || result?.raw?.data?.transaction || {};
  const raw = result?.raw || {};
  const responseCode = status.response_code || raw.status_code || null;
  const codeMeta = getAirtelResponseCodeMeta(responseCode);

  return {
    httpStatus: result.httpStatus ?? null,
    success: Boolean(status.success ?? result.ok),
    statusCode: status.code || raw.status_code || result.statusCode || null,
    message: status.message || result.message || raw.status_message || result.error || null,
    responseCode,
    responseReason: codeMeta?.reason || null,
    responseCodeDescription: codeMeta?.description || describeAirtelResponseCode(responseCode),
    resultCode: status.result_code || null,
    transactionId: transaction.id || result.transactionId || result.payload?.transaction?.id || null,
    transactionStatus: transaction.status || result.statusCode || null,
    airtelMoneyId: transaction.airtel_money_id || result.airtelMoneyId || null,
  };
}

async function runCustomAction(action, params = {}) {
  const startedAt = new Date().toISOString();

  try {
    if (action === 'collection') {
      const merchantReference = params.reference || buildReference('UATCOL', params.caseId);
      const result = await airtel.invokeCollection({
        merchantReference,
        amount: params.amount,
        phone: params.msisdn,
        reference: params.referenceLabel || `MOVOUAT${Math.trunc(Number(params.amount || 0))}`,
      });

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: {
          msisdn: params.msisdn,
          amount: Math.trunc(Number(params.amount)),
          transactionId: result.payload?.transaction?.id || merchantReference,
          reference: result.payload?.reference || null,
          payload: result.payload || null,
        },
        response: summarizeResponse(result),
        raw: result.raw,
      };
    }

    if (action === 'disbursement') {
      const merchantReference = params.reference || buildReference('UATDIS', params.caseId);
      const pin = params.pin || readEnv('AIRTEL_DISBURSEMENT_PIN');
      const encryptedPin = params.encryptedPin || readEnv('AIRTEL_DISBURSEMENT_PIN_ENCRYPTED');

      if (!pin && !encryptedPin) {
        return {
          startedAt,
          finishedAt: new Date().toISOString(),
          action,
          error: 'Disbursement PIN is required. Set AIRTEL_DISBURSEMENT_PIN on the server or enter it in the UAT dashboard.',
        };
      }

      const transactionType = resolveDisbursementTransactionType(params);
      const result = await airtel.invokeDisbursement({
        merchantReference,
        amount: params.amount,
        phone: params.msisdn,
        pin,
        encryptedPin,
        payeeName: params.payeeName || 'MovoBrands UAT',
        reference: merchantReference,
        transactionType,
        signRequest: params.signRequest,
      });

      const response = summarizeResponse(result);
      let statusEnquiry = null;
      let resolvedResponse = null;

      if (response.transactionId && isPendingDisbursement(response)) {
        statusEnquiry = await pollDisbursementStatus(response.transactionId, transactionType);
        const lastAttempt = statusEnquiry[statusEnquiry.length - 1];
        if (lastAttempt && isTerminalDisbursement(lastAttempt.response)) {
          resolvedResponse = lastAttempt.response;
        }
      }

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: {
          msisdn: params.msisdn,
          amount: params.amount,
          reference: merchantReference,
          transactionType,
          pinProvided: Boolean(pin || encryptedPin),
          pinOverridden: Boolean(params.pin || params.encryptedPin),
          pinSource: params.encryptedPin || encryptedPin ? 'encrypted_override' : params.pin ? 'dashboard_override' : 'server_env',
          disbursementSigned: result.disbursementSigned ?? false,
          pinKeySource: result.pinKeySource || null,
        },
        response,
        resolvedResponse,
        statusEnquiry,
        raw: result.raw,
      };
    }

    if (action === 'kyc') {
      const result = await airtel.invokeUserEnquiry(params.msisdn);
      const user = result.raw?.data || {};

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: { msisdn: params.msisdn },
        response: {
          ...summarizeResponse(result),
          firstName: user.first_name || null,
          lastName: user.last_name || null,
          grade: user.grade || null,
          isBarred: user.is_barred ?? null,
          isPinSet: user.is_pin_set ?? null,
          registrationStatus: user.registration?.status || null,
        },
        raw: result.raw,
      };
    }

    if (action === 'collection_status' || action === 'disbursement_status') {
      const result = action === 'disbursement_status'
        ? await airtel.invokeDisbursementStatus(params.transactionId, resolveDisbursementTransactionType(params))
        : await airtel.invokeCollectionStatus(params.transactionId);

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: { transactionId: params.transactionId },
        response: summarizeResponse(result),
        raw: result.raw,
      };
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      action,
      error: `Unsupported action: ${action}`,
    };
  } catch (error) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      action,
      error: error.message || 'UAT action failed',
      response: summarizeResponse({
        ok: false,
        error: error.message,
        httpStatus: error.status || null,
        raw: error.raw || null,
        statusCode: error.code || null,
      }),
      raw: error.raw || null,
    };
  }
}

async function runUatCase(caseIdValue, overrides = {}, testNumbers = {}) {
  const testCase = getUatCase(caseIdValue);
  if (!testCase) {
    return {
      error: `Unknown UAT case: ${caseIdValue}`,
    };
  }

  const resolvedMsisdn = resolveCaseMsisdn(testCase, testNumbers);

  const params = {
    ...testCase.params,
    ...overrides,
    ...(resolvedMsisdn ? { msisdn: resolvedMsisdn } : {}),
    caseId: testCase.id,
  };

  const result = await runCustomAction(testCase.action, params);

  return {
    case: testCase,
    resolvedMsisdn,
    testNumbers: testNumbers || {},
    result,
  };
}

module.exports = {
  runUatCase,
  runCustomAction,
};
