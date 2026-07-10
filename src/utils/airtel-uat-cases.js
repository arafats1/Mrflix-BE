'use strict';

/**
 * Airtel Uganda UAT test cases provided by the Airtel integration team.
 * MSISDN values omit the country code (256) per API docs.
 */

const DEFAULT_COLLECTION_MSISDN = '706218827';
const BARRED_MSISDN = '752600157';
const UNREGISTERED_MSISDN = '7500002240';
const BELOW_MIN_DISBURSE_MSISDN = '756255985';

const DEFAULT_UAT_NUMBERS = {
  collection: DEFAULT_COLLECTION_MSISDN,
  disbursement: DEFAULT_COLLECTION_MSISDN,
  barred: BARRED_MSISDN,
  unregistered: UNREGISTERED_MSISDN,
  belowMin: BELOW_MIN_DISBURSE_MSISDN,
};

const MSISDN_KEY_LABELS = {
  collection: 'Collection (registered subscriber)',
  disbursement: 'Disbursement (registered payee)',
  barred: 'Barred subscriber',
  unregistered: 'Unregistered number',
  belowMin: 'Below-minimum disbursement',
};

function caseId(group, index) {
  return `${group}-${index}`;
}

function normalizeUatMsisdn(value) {
  return String(value || '').replace(/\D/g, '').replace(/^256/, '');
}

function resolveCaseMsisdn(testCase, testNumbers = {}) {
  const key = testCase.msisdnKey;
  const caseDefault = normalizeUatMsisdn(testCase.params?.msisdn);
  const configured = key ? normalizeUatMsisdn(testNumbers[key]) : '';

  // Airtel UAT special numbers (barred / unregistered / below-min) must not
  // silently fall back to the main collection MSISDN — that makes limit tests
  // succeed incorrectly (e.g. 200 UGX to 706218827 returns Success).
  const lockedKeys = new Set(['belowMin', 'barred', 'unregistered']);
  if (lockedKeys.has(key) && caseDefault) {
    const mainNumbers = new Set(
      [
        normalizeUatMsisdn(testNumbers.collection),
        normalizeUatMsisdn(testNumbers.disbursement),
        DEFAULT_COLLECTION_MSISDN,
      ].filter(Boolean)
    );

    if (!configured || mainNumbers.has(configured)) {
      return caseDefault;
    }
  }

  if (configured) return configured;
  return caseDefault;
}

const COLLECTION_CASES = [
  {
    id: caseId('collection', 1),
    group: 'collections',
    title: 'Initiate push for 6000',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 6000 },
    notes: 'Successful collection on a registered subscriber. Approve with the correct PIN. For wrong-PIN testing: enter an incorrect PIN on the handset, then click Status — expect DP00800001002 (Incorrect Pin). Airtel often does not send a callback for wrong PIN; Status enquiry is the source of truth.',
    expectedCodes: ['DP00800001001', 'DP00800001002', 'DP00800001005'],
  },
  {
    id: caseId('collection', 2),
    group: 'collections',
    title: 'Initiate push to barred number 2000',
    action: 'collection',
    msisdnKey: 'barred',
    params: { msisdn: BARRED_MSISDN, amount: 2000 },
    notes: 'Expect failure while the subscriber is barred (often DP00800001008 / DP00800001010).',
    expectedCodes: ['DP00800001008', 'DP00800001010', 'DP00800001009'],
  },
  {
    id: caseId('collection', 3),
    group: 'collections',
    title: 'Initiate push of 2500 after unbarred',
    action: 'collection',
    msisdnKey: 'barred',
    params: { msisdn: BARRED_MSISDN, amount: 2500 },
    notes: 'Run after Airtel unbars the test number in sandbox. Approve on phone for success.',
    expectedCodes: ['DP00800001001'],
  },
  {
    id: caseId('collection', 4),
    group: 'collections',
    title: 'Initiate push for insufficient balance 2M',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 2000000 },
    notes: 'Expect DP00800001007 (Not enough balance). If push is accepted first, approve/decline on phone then click Status.',
    expectedCodes: ['DP00800001007'],
  },
  {
    id: caseId('collection', 5),
    group: 'collections',
    title: 'Initiate push for amount 5.1M above transaction limit',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 5100000 },
    notes: 'Airtel often accepts the push first as DP00800001006 (In process). Over-limit DP00800001003 is a wallet/authorization check — it may only appear after the handset USSD/PIN attempt, a later Status enquiry, or transaction timeout (DP00800001024/029). If Status stays In process with no USSD, ask Airtel to confirm the sandbox collection limit for this merchant.',
    expectedCodes: ['DP00800001003', 'DP00800001006', 'DP00800001024', 'DP00800001029'],
  },
  {
    id: caseId('collection', 6),
    group: 'collections',
    title: 'Initiate push for amount less than 500 (min amount)',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 499 },
    notes: 'Expect DP00800001004 (Invalid Amount / below minimum).',
    expectedCodes: ['DP00800001004'],
  },
  {
    id: caseId('collection', 7),
    group: 'collections',
    title: 'Initiate push for amount 0',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 0 },
    notes: 'Expect validation failure (invalid amount).',
    expectedCodes: ['DP00800001004'],
  },
  {
    id: caseId('collection', 8),
    group: 'collections',
    title: 'Initiate push for amount with decimals (500.78)',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: 500.78 },
    notes: 'Sends 500.78 without truncating. Expect decimal amount rejection.',
    expectedCodes: ['DP00800001004'],
  },
  {
    id: caseId('collection', 9),
    group: 'collections',
    title: 'Initiate push for negative amount (-8000)',
    action: 'collection',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN, amount: -8000 },
    notes: 'Expect validation failure for negative amount.',
    expectedCodes: ['DP00800001004'],
  },
  {
    id: caseId('collection', 10),
    group: 'collections',
    title: 'Initiate push to unregistered number',
    action: 'collection',
    msisdnKey: 'unregistered',
    params: { msisdn: UNREGISTERED_MSISDN, amount: 5000 },
    notes: 'Expect user-not-found / invalid MSISDN rejection (often DP00800001010).',
    expectedCodes: ['DP00800001010', 'DP00800001008'],
  },
  {
    id: caseId('collection', 11),
    group: 'collections',
    title: 'Account enquiry (KYC)',
    action: 'kyc',
    msisdnKey: 'collection',
    params: { msisdn: DEFAULT_COLLECTION_MSISDN },
    notes: 'User enquiry before collection. Expect DP02200000001.',
    expectedCodes: ['DP02200000001'],
  },
];

const DISBURSEMENT_CASES = [
  {
    id: caseId('disbursement', 1),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt 8000',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: 8000 },
    notes: 'Successful disbursement.',
  },
  {
    id: caseId('disbursement', 2),
    group: 'disbursements',
    title: 'Deposit to barred 752600157 Amt 6000',
    action: 'disbursement',
    msisdnKey: 'barred',
    params: { msisdn: BARRED_MSISDN, amount: 6000 },
    notes: 'Expect failure while payee is barred.',
  },
  {
    id: caseId('disbursement', 3),
    group: 'disbursements',
    title: 'Deposit to unbarred 752600157 Amt 6000',
    action: 'disbursement',
    msisdnKey: 'barred',
    params: { msisdn: BARRED_MSISDN, amount: 6000 },
    notes: 'Run after Airtel unbars the test number in sandbox.',
  },
  {
    id: caseId('disbursement', 4),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt 5,100,000',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: 5100000 },
    notes: 'Same as collection over-limit: Airtel may first return Ambiguous/In process. Expect DP00900001003 or DP00900001004 after Status enquiry, or ask Airtel if sandbox never rejects.',
    expectedCodes: ['DP00900001003', 'DP00900001004', 'DP00900001000', 'DP00900001006'],
  },
  {
    id: caseId('disbursement', 5),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt 500,000 with wrong pin',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: 500000, pin: '0000' },
    notes: 'Override PIN with an invalid value for this test. Expect PIN / auth failure (ROUTER116 or disbursement failed code).',
    expectedCodes: ['ROUTER116', 'DP00900001005'],
  },
  {
    id: caseId('disbursement', 6),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt 0',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: 0 },
    notes: 'Expect validation failure.',
  },
  {
    id: caseId('disbursement', 7),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt 5000.89',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: 5000.89 },
    notes: 'Expect decimal amount rejection.',
  },
  {
    id: caseId('disbursement', 8),
    group: 'disbursements',
    title: 'Deposit to 706218827 Amt -10000 (negative)',
    action: 'disbursement',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827', amount: -10000 },
    notes: 'Expect validation failure.',
  },
  {
    id: caseId('disbursement', 9),
    group: 'disbursements',
    title: 'Deposit to 7500002240 Amt 7000 unregistered number',
    action: 'disbursement',
    msisdnKey: 'unregistered',
    params: { msisdn: UNREGISTERED_MSISDN, amount: 7000 },
    notes: 'Expect user-not-found rejection.',
  },
  {
    id: caseId('disbursement', 10),
    group: 'disbursements',
    title: 'Deposit amount 200 to 756255985 (below minimum)',
    action: 'disbursement',
    msisdnKey: 'belowMin',
    params: { msisdn: BELOW_MIN_DISBURSE_MSISDN, amount: 200 },
    notes: 'Must use MSISDN 756255985 (Airtel below-minimum test number). Expect DP00900001004 (Invalid Amount — out of range). Sending 200 to the normal collection number can succeed and is not a valid test.',
    expectedCodes: ['DP00900001004'],
  },
  {
    id: caseId('disbursement', 11),
    group: 'disbursements',
    title: 'KYC validation',
    action: 'kyc',
    msisdnKey: 'disbursement',
    params: { msisdn: '706218827' },
    notes: 'Validate payee before disbursement.',
  },
];

const ALL_CASES = [...COLLECTION_CASES, ...DISBURSEMENT_CASES];

function getUatCases(group) {
  if (!group) return ALL_CASES;
  return ALL_CASES.filter((item) => item.group === group);
}

function getUatCase(caseIdValue) {
  return ALL_CASES.find((item) => item.id === caseIdValue) || null;
}

module.exports = {
  ALL_CASES,
  COLLECTION_CASES,
  DISBURSEMENT_CASES,
  DEFAULT_UAT_NUMBERS,
  MSISDN_KEY_LABELS,
  getUatCases,
  getUatCase,
  resolveCaseMsisdn,
  normalizeUatMsisdn,
};
