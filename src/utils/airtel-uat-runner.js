'use strict';

const airtel = require('./airtel');
const { getUatCase } = require('./airtel-uat-cases');

function readEnv(name) {
  return String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

function buildReference(prefix, caseIdValue) {
  const stamp = Date.now().toString(36).toUpperCase();
  const safeCaseId = String(caseIdValue || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
  return `${prefix}_${safeCaseId}_${stamp}`;
}

function summarizeResponse(result) {
  const status = result?.data?.status || result?.raw?.status || {};
  const transaction = result?.data?.transaction || result?.raw?.data?.transaction || {};

  return {
    httpStatus: result.httpStatus ?? null,
    success: Boolean(status.success ?? result.ok),
    statusCode: status.code || status.response_code || result.statusCode || null,
    message: status.message || result.message || result.error || null,
    responseCode: status.response_code || null,
    resultCode: status.result_code || null,
    transactionId: transaction.id || result.transactionId || null,
    transactionStatus: transaction.status || result.statusCode || null,
    airtelMoneyId: transaction.airtel_money_id || result.airtelMoneyId || null,
  };
}

async function runCustomAction(action, params = {}) {
  const startedAt = new Date().toISOString();

  try {
    if (action === 'collection') {
      const merchantReference = params.reference || buildReference('UAT_COL', params.caseId);
      const result = await airtel.invokeCollection({
        merchantReference,
        amount: params.amount,
        phone: params.msisdn,
        reference: params.referenceLabel || `UAT ${params.caseId || 'custom'}`,
      });

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: {
          msisdn: params.msisdn,
          amount: params.amount,
          reference: merchantReference,
        },
        response: summarizeResponse(result),
        raw: result.raw,
      };
    }

    if (action === 'disbursement') {
      const merchantReference = params.reference || buildReference('UAT_DIS', params.caseId);
      const pin = params.pin || readEnv('AIRTEL_DISBURSEMENT_PIN');

      if (!pin) {
        return {
          startedAt,
          finishedAt: new Date().toISOString(),
          action,
          error: 'AIRTEL_DISBURSEMENT_PIN is not configured on the server.',
        };
      }

      const result = await airtel.invokeDisbursement({
        merchantReference,
        amount: params.amount,
        phone: params.msisdn,
        pin,
        payeeName: params.payeeName || 'MovoBrands UAT',
        reference: params.referenceLabel || `UAT ${params.caseId || 'custom'}`,
        transactionType: params.transactionType || 'B2B',
      });

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        action,
        request: {
          msisdn: params.msisdn,
          amount: params.amount,
          reference: merchantReference,
          pinProvided: Boolean(pin),
          pinOverridden: Boolean(params.pin),
        },
        response: summarizeResponse(result),
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
        ? await airtel.invokeDisbursementStatus(params.transactionId, params.transactionType || 'B2B')
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

async function runUatCase(caseIdValue, overrides = {}) {
  const testCase = getUatCase(caseIdValue);
  if (!testCase) {
    return {
      error: `Unknown UAT case: ${caseIdValue}`,
    };
  }

  const params = {
    ...testCase.params,
    ...overrides,
    caseId: testCase.id,
  };

  const result = await runCustomAction(testCase.action, params);

  return {
    case: testCase,
    result,
  };
}

module.exports = {
  runUatCase,
  runCustomAction,
};
