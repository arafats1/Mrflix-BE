'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const {
  carProductFilters,
  findByIdOrDocumentId,
  simulateBureauCheck,
} = require('../../../utils/cars');
const { findCarKycForUser } = require('../../../utils/car-kyc');

const LOAN_UID = 'api::car-loan-application.car-loan-application';
const KYC_UID = 'api::car-kyc.car-kyc';
const INSPECTION_UID = 'api::car-inspection-booking.car-inspection-booking';
const PREQUAL_UID = 'api::car-prequalification.car-prequalification';
const PRODUCT_UID = 'api::product.product';
const SETTINGS_UID = 'api::site-setting.site-setting';

const LOAN_STATUSES = new Set([
  'new',
  'reviewing',
  'crb_fee_due',
  'credit_checked',
  'offer_ready',
  'offer_accepted',
  'offer_declined',
  'awaiting_bank_inspection',
  'documents_required',
  'documents_uploaded',
  'with_partners',
  'approved',
  'declined',
  'archived',
]);

const EMPLOYMENT_STATUS = new Set(['salary_earner', 'business_owner', 'self_employed']);
const GENDERS = new Set(['male', 'female']);
const NATIONALITY_STATUS = new Set(['citizen', 'resident', 'non_resident']);
const INTEREST_TYPES = new Set(['floating', 'fixed']);
const FEE_TIMING = new Set(['upfront', 'monthly']);
const UPFRONT_ITEMS = new Set([
  'vehicle_registration',
  'vehicle_tracking',
  'credit_life_insurance',
  'insurance_first_12_months',
  'maintenance_plan',
  'warranty',
]);

const BANK_CONTACTS = {
  dfcu: {
    id: 'dfcu',
    name: 'DFCU Bank',
    phone: '+256 312 300000',
    note: 'Pay the down payment and receive disbursement through the bank. MOVO does not collect car payments.',
  },
  stanbic: {
    id: 'stanbic',
    name: 'Stanbic Bank',
    phone: '+256 312 224600',
    note: 'Pay the down payment and receive disbursement through the bank. MOVO does not collect car payments.',
  },
  centenary: {
    id: 'centenary',
    name: 'Centenary Bank',
    phone: '+256 312 202600',
    note: 'Pay the down payment and receive disbursement through the bank. MOVO does not collect car payments.',
  },
};

const DEFAULT_REQUIRED_DOCS = [
  { id: 'signed_agreement', label: 'Signed loan terms and conditions', required: true, applicantType: 'all' },
  { id: 'national_id', label: 'National ID / NIN copy', required: true, applicantType: 'all' },
  { id: 'proof_of_income', label: 'Proof of income (payslip or bank statement)', required: true, applicantType: 'all' },
  { id: 'business_registration', label: 'Business registration certificate', required: true, applicantType: 'business' },
  { id: 'tin_certificate', label: 'TIN certificate', required: true, applicantType: 'business' },
];

function trim(value) {
  return String(value ?? '').trim();
}

function toBool(value) {
  if (value === true || value === 'yes' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'no' || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatUGX(value) {
  const amount = Number(value) || 0;
  return `UGX ${amount.toLocaleString('en-UG')}`;
}

function bankContact(bankName) {
  const key = trim(bankName).toLowerCase();
  if (key.includes('dfcu')) return BANK_CONTACTS.dfcu;
  if (key.includes('stanbic')) return BANK_CONTACTS.stanbic;
  if (key.includes('centenary')) return BANK_CONTACTS.centenary;
  return {
    id: 'bank',
    name: trim(bankName) || 'Partner bank',
    phone: '',
    note: 'Pay the down payment and receive disbursement through the bank. MOVO does not collect car payments.',
  };
}

function selectedBank(body = {}, existingBankName) {
  const requestedId = trim(body.bankId).toLowerCase();
  const requestedName = trim(body.bankName);
  if (BANK_CONTACTS[requestedId]) {
    return BANK_CONTACTS[requestedId];
  }
  if (requestedName) {
    return bankContact(requestedName);
  }
  return bankContact(existingBankName);
}

function normalizeDocuments(value) {
  return Array.isArray(value) ? value.filter((item) => item && (item.url || item.id)) : [];
}

function repaymentSchedule(loan) {
  const months = Math.max(1, Number(loan.offerTermMonths) || 12);
  const monthly = Number(loan.offerMonthlyUGX) || 0;
  if (!monthly) return [];
  return Array.from({ length: months }, (_, index) => ({
    installment: index + 1,
    label: `Month ${index + 1}`,
    amountUGX: monthly,
    collectedOnMovo: false,
    note: 'Paid at the dealer premises, not on MOVO.',
  }));
}

function requiredDocumentsFor(applicantType, settingsDocs) {
  const source = Array.isArray(settingsDocs) && settingsDocs.length ? settingsDocs : DEFAULT_REQUIRED_DOCS;
  return source.filter((doc) => {
    const type = doc.applicantType || 'all';
    return type === 'all' || type === applicantType;
  });
}

async function getFinanceSettings(strapi) {
  const rows = await strapi.entityService.findMany(SETTINGS_UID);
  const settings = Array.isArray(rows) ? rows[0] : rows;
  return {
    carCrbFeeUGX: Math.max(0, Number(settings?.carCrbFeeUGX) || 25000),
    carRequiredDocuments: Array.isArray(settings?.carRequiredDocuments)
      ? settings.carRequiredDocuments
      : DEFAULT_REQUIRED_DOCS,
    carBankTermsDocuments: settings?.carBankTermsDocuments && typeof settings.carBankTermsDocuments === 'object'
      ? settings.carBankTermsDocuments
      : {},
  };
}

function bankTermsKey(bankName) {
  const bank = bankContact(bankName);
  const id = trim(bank?.id).toLowerCase();
  if (id && id !== 'bank') return id;
  return trim(bankName).toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

async function findKycForUser(strapi, user) {
  return findCarKycForUser(strapi, user);
}

async function resolveProduct(strapi, id) {
  const raw = trim(id);
  if (!raw) return null;
  const populate = { seller: true };
  const byDocumentId = await strapi.db.query(PRODUCT_UID).findOne({
    where: { documentId: raw },
    populate,
  });
  if (byDocumentId) return byDocumentId;
  if (/^\d+$/.test(raw)) {
    return strapi.db.query(PRODUCT_UID).findOne({
      where: { id: Number(raw) },
      populate,
    });
  }
  return null;
}

function ownsLoan(entry, user) {
  if (!entry || !user) return false;
  const ownerId = entry.user?.id || entry.user;
  if (ownerId && Number(ownerId) === Number(user.id)) return true;
  if (trim(entry.email).toLowerCase() && trim(entry.email).toLowerCase() === trim(user.email).toLowerCase()) return true;
  return false;
}

function dealerFromProduct(product) {
  const seller = product?.seller || {};
  return {
    dealerName: trim(seller.fullName) || trim(seller.username) || trim(product?.sellerName) || '',
    dealerPhone: trim(seller.phone) || trim(product?.paymentPhone) || '',
  };
}

function shapeLoan(entry, extras = {}) {
  if (!entry) return null;
  const bank = bankContact(entry.bankName);
  return {
    id: entry.documentId || entry.id,
    documentId: entry.documentId,
    status: entry.status,
    carDocumentId: entry.carDocumentId,
    carTitle: entry.carTitle,
    loanType: entry.loanType || 'hire_purchase',
    bankName: entry.bankName || (entry.loanType === 'bank' ? bank.name : null),
    bankPhone: bank.phone,
    bankNote: bank.note,
    firstName: entry.firstName,
    lastName: entry.lastName,
    email: entry.email,
    phoneCountryCode: entry.phoneCountryCode,
    phoneNumber: entry.phoneNumber,
    nationalId: entry.nationalId,
    hirePurchaseMonthlyUGX: entry.hirePurchaseMonthlyUGX,
    hirePurchaseDepositPercent: entry.hirePurchaseDepositPercent,
    crbFeeUGX: entry.crbFeeUGX,
    crbFeePaidAt: entry.crbFeePaidAt,
    creditScore: entry.creditScore,
    scoreBand: entry.scoreBand,
    maxBankLoanUGX: entry.maxBankLoanUGX,
    creditCheckedAt: entry.creditCheckedAt,
    offerLoanAmountUGX: entry.offerLoanAmountUGX,
    offerDepositUGX: entry.offerDepositUGX,
    offerMonthlyUGX: entry.offerMonthlyUGX,
    offerTermMonths: entry.offerTermMonths,
    offerHirePurchasePriceUGX: entry.offerHirePurchasePriceUGX,
    offerAcceptedAt: entry.offerAcceptedAt,
    offerDeclinedAt: entry.offerDeclinedAt,
    dealerName: entry.dealerName,
    dealerPhone: entry.dealerPhone,
    signedAgreementUrl: entry.signedAgreementUrl,
    supportingDocuments: normalizeDocuments(entry.supportingDocuments),
    repaymentSchedule: repaymentSchedule(entry),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...extras,
  };
}

function agreementHtml(entry) {
  const bank = bankContact(entry.bankName);
  const customer = `${trim(entry.firstName)} ${trim(entry.lastName)}`.trim();
  const dealer = trim(entry.dealerName) || 'the selling dealer';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MOVO sample car finance terms</title>
  <style>
    body { font-family: Georgia, serif; color: #111; max-width: 720px; margin: 40px auto; line-height: 1.55; }
    h1, h2 { font-family: Arial, sans-serif; color: #1c2452; }
    .badge { display: inline-block; background: #f4f5f7; border: 1px solid #ddd; padding: 4px 10px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .note { background: #fff4f4; border: 1px solid #DD1F26; padding: 12px 16px; }
  </style>
</head>
<body>
  <p class="badge">SAMPLE DOCUMENT — replace with the bank agreement when available</p>
  <h1>Car finance terms and conditions</h1>
  <p>This sample agreement is issued by MOVO to connect ${customer || 'the customer'} with ${dealer} and ${bank.name}. It is not a bank facility letter.</p>
  <h2>1. Parties</h2>
  <p>Customer: ${customer || '—'} (NIN ${trim(entry.nationalId) || '—'})</p>
  <p>Dealer: ${dealer}${entry.dealerPhone ? ` · ${entry.dealerPhone}` : ''}</p>
  <p>Bank: ${bank.name}${bank.phone ? ` · ${bank.phone}` : ''}</p>
  <h2>2. Vehicle</h2>
  <p>${trim(entry.carTitle) || 'The financed vehicle as listed on MOVO Cars.'}</p>
  <h2>3. Indicative offer</h2>
  <table>
    <tr><th>Hire purchase price</th><td>${formatUGX(entry.offerHirePurchasePriceUGX)}</td></tr>
    <tr><th>Down payment (paid to the bank, not MOVO)</th><td>${formatUGX(entry.offerDepositUGX)}</td></tr>
    <tr><th>Financed amount</th><td>${formatUGX(entry.offerLoanAmountUGX)}</td></tr>
    <tr><th>Monthly instalment</th><td>${formatUGX(entry.offerMonthlyUGX)}</td></tr>
    <tr><th>Term</th><td>${entry.offerTermMonths || 12} months</td></tr>
  </table>
  <div class="note">
    <strong>Payments off MOVO.</strong> The customer pays the down payment and receives disbursement through the bank.
    Instalments, loan close, and ownership release happen at the dealer premises. MOVO does not collect car payments.
  </div>
  <h2>4. Inspection</h2>
  <p>Vehicle inspection is arranged by the bank, not MOVO. This document is issued after the bank confirms inspection to the customer.</p>
  <h2>5. Credit reference</h2>
  <p>The customer authorised a credit reference bureau check. The current check is simulated until a live bureau API is connected. CRB fee: ${formatUGX(entry.crbFeeUGX)}.</p>
  <h2>6. Signing</h2>
  <p>Print, sign, and upload this document together with the other documents requested by the bank. Upload the signed copy on MOVO so the bank and dealer can proceed.</p>
  <p>Signed by: _______________________ &nbsp;&nbsp; Date: _______________</p>
  <p>Customer name: ${customer || '_______________________'}</p>
</body>
</html>`;
}

module.exports = createCoreController('api::car-loan-application.car-loan-application', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('Log in to submit a car finance application');

    const kyc = await findKycForUser(strapi, user);
    if (!kyc || !['pending', 'approved'].includes(kyc.status)) {
      return ctx.badRequest('Complete KYC or KYB before submitting a loan application');
    }

    const firstName = trim(body.firstName);
    const lastName = trim(body.lastName);
    const phoneCountryCode = trim(body.phoneCountryCode) || '256';
    const phoneNumber = trim(body.phoneNumber).replace(/\s+/g, '');
    const email = trim(body.email).toLowerCase();
    const employmentStatus = trim(body.employmentStatus);
    const dateOfBirth = trim(body.dateOfBirth);
    const nationalId = trim(body.nationalId);
    const heardAboutUs = trim(body.heardAboutUs);
    const gender = trim(body.gender);
    const nationality = trim(body.nationality);
    const nationalityStatus = trim(body.nationalityStatus);
    const occupation = trim(body.occupation);
    const industry = trim(body.industry);
    const employerOrBusinessName = trim(body.employerOrBusinessName);
    const workEmail = trim(body.workEmail).toLowerCase();
    const monthlyIncomeUGX = toInt(body.monthlyIncomeUGX);
    const employmentDuration = trim(body.employmentDuration);
    const wantsTradeIn = toBool(body.wantsTradeIn);
    const consentDataSharing = toBool(body.consentDataSharing);
    const consentCreditEnquiry = toBool(body.consentCreditEnquiry);
    const consentApprovalDisclaimer = toBool(body.consentApprovalDisclaimer);
    const consentTermsPrivacy = toBool(body.consentTermsPrivacy);

    if (!firstName || !lastName || !phoneNumber || !email) {
      return ctx.badRequest('Missing required Quick Info fields');
    }
    if (!EMPLOYMENT_STATUS.has(employmentStatus)) {
      return ctx.badRequest('Invalid employment status');
    }
    if (!dateOfBirth || !nationalId || !heardAboutUs || !GENDERS.has(gender) || !nationality || !NATIONALITY_STATUS.has(nationalityStatus)) {
      return ctx.badRequest('Missing required About Me fields');
    }
    if (!occupation || !industry || !employerOrBusinessName || monthlyIncomeUGX == null || monthlyIncomeUGX < 0 || !employmentDuration) {
      return ctx.badRequest('Missing required profession fields');
    }
    if (wantsTradeIn == null) {
      return ctx.badRequest('Please say whether you want to trade in your current car');
    }
    if (
      consentDataSharing !== true
      || consentCreditEnquiry !== true
      || consentApprovalDisclaimer !== true
      || consentTermsPrivacy !== true
    ) {
      return ctx.badRequest('All consents must be accepted to submit this application');
    }

    const interestRateType = trim(body.interestRateType);
    const feePaymentTiming = trim(body.feePaymentTiming);
    const upfrontItems = Array.isArray(body.upfrontItems)
      ? body.upfrontItems.map((item) => trim(item)).filter((item) => UPFRONT_ITEMS.has(item))
      : [];

    const product = await resolveProduct(strapi, body.carDocumentId || body.productId);
    const hirePurchaseMonthlyUGX = toInt(body.hirePurchaseMonthlyUGX);
    const hirePurchaseDepositPercent = toInt(body.hirePurchaseDepositPercent);
    const finance = await getFinanceSettings(strapi);
    const dealer = dealerFromProduct(product);
    const loanType = trim(body.loanType) === 'bank' ? 'bank' : 'hire_purchase';
    const bankName = trim(body.bankName) || (loanType === 'bank' ? BANK_CONTACTS.dfcu.name : null);

    const data = {
      status: 'crb_fee_due',
      carDocumentId: trim(body.carDocumentId) || product?.documentId || null,
      carTitle: trim(body.carTitle) || product?.name || null,
      hirePurchaseMonthlyUGX: hirePurchaseMonthlyUGX ?? product?.hirePurchaseMonthlyUGX ?? null,
      hirePurchaseDepositPercent: hirePurchaseDepositPercent ?? product?.hirePurchaseDepositPercent ?? null,
      firstName,
      lastName,
      phoneCountryCode,
      phoneNumber,
      email,
      employmentStatus,
      dateOfBirth,
      nationalId,
      heardAboutUs,
      gender,
      nationality,
      nationalityStatus,
      occupation,
      industry,
      employerOrBusinessName,
      workEmail: workEmail || null,
      monthlyIncomeUGX,
      employmentDuration,
      wantsTradeIn,
      desiredEquityUGX: toInt(body.desiredEquityUGX),
      desiredMonthlyPaymentUGX: toInt(body.desiredMonthlyPaymentUGX),
      interestRateType: INTEREST_TYPES.has(interestRateType) ? interestRateType : null,
      desiredInterestRatePercent: toDecimal(body.desiredInterestRatePercent),
      desiredResidualPercent: toInt(body.desiredResidualPercent),
      desiredLoanTermMonths: toInt(body.desiredLoanTermMonths),
      desiredRepaymentDate: trim(body.desiredRepaymentDate) || null,
      continueInsuranceAfterYearOne: toBool(body.continueInsuranceAfterYearOne),
      feePaymentTiming: FEE_TIMING.has(feePaymentTiming) ? feePaymentTiming : null,
      upfrontItems,
      consentDataSharing,
      consentCreditEnquiry,
      consentApprovalDisclaimer,
      consentTermsPrivacy,
      loanType,
      bankName,
      creditScore: toInt(body.creditScore),
      maxBankLoanUGX: toInt(body.maxBankLoanUGX),
      crbFeeUGX: finance.carCrbFeeUGX,
      dealerName: dealer.dealerName,
      dealerPhone: dealer.dealerPhone,
      supportingDocuments: [],
    };

    if (product?.id) data.product = product.id;
    data.user = user.id;

    const entry = await strapi.entityService.create(LOAN_UID, { data });

    return {
      data: {
        id: entry.documentId || entry.id,
        documentId: entry.documentId,
        status: entry.status,
        message: 'Application received. Pay the CRB fee to run the credit check.',
      },
    };
  },

  async mine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const entries = await strapi.entityService.findMany(LOAN_UID, {
      filters: {
        $or: [
          { user: { id: user.id } },
          { email: user.email },
        ],
      },
      sort: { createdAt: 'desc' },
    });

    return { data: (entries || []).map((entry) => shapeLoan(entry)) };
  },

  async findMine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');

    const kyc = await findKycForUser(strapi, user);
    const finance = await getFinanceSettings(strapi);
    const applicantType = kyc?.applicantType === 'business' ? 'business' : 'individual';

    return {
      data: shapeLoan(existing, {
        requiredDocuments: requiredDocumentsFor(applicantType, finance.carRequiredDocuments),
        applicantType,
        kycStatus: kyc?.status || null,
        crbFeeDueUGX: existing.crbFeeUGX || finance.carCrbFeeUGX,
      }),
    };
  },

  async payCrbFee(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');
    if (!['new', 'crb_fee_due', 'reviewing'].includes(existing.status)) {
      return ctx.badRequest('CRB fee is not due on this application');
    }

    const finance = await getFinanceSettings(strapi);
    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: {
        status: 'crb_fee_due',
        crbFeeUGX: existing.crbFeeUGX || finance.carCrbFeeUGX,
        crbFeePaidAt: new Date(),
      },
    });

    return {
      data: shapeLoan(updated, {
        message: 'CRB fee recorded. You can now run the simulated bureau check.',
        simulatedPayment: true,
      }),
    };
  },

  async runCreditCheck(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user', 'product'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');
    if (!existing.crbFeePaidAt) {
      return ctx.badRequest('Pay the CRB fee before running the credit check');
    }
    if (['offer_declined', 'archived'].includes(existing.status)) {
      return ctx.badRequest('This application can no longer run a credit check');
    }

    const body = ctx.request.body?.data || ctx.request.body || {};
    const bank = selectedBank(body, existing.bankName);
    const product = existing.product || (existing.carDocumentId
      ? await resolveProduct(strapi, existing.carDocumentId)
      : null);
    const dealer = dealerFromProduct(product);
    const result = simulateBureauCheck({
      nin: existing.nationalId,
      bankId: bank?.id || 'dfcu',
      carPriceUGX: product?.priceUGX,
      depositPercent: existing.hirePurchaseDepositPercent || product?.hirePurchaseDepositPercent,
    });

    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: {
        status: 'offer_ready',
        creditScore: result.creditScore,
        scoreBand: result.scoreBand,
        maxBankLoanUGX: result.maxBankLoanUGX,
        creditCheckedAt: new Date(),
        offerLoanAmountUGX: result.offerLoanAmountUGX,
        offerDepositUGX: result.offerDepositUGX,
        offerMonthlyUGX: result.offerMonthlyUGX,
        offerTermMonths: result.offerTermMonths,
        offerHirePurchasePriceUGX: result.offerHirePurchasePriceUGX,
        bankName: bank?.name || existing.bankName || BANK_CONTACTS.dfcu.name,
        dealerName: existing.dealerName || dealer.dealerName,
        dealerPhone: existing.dealerPhone || dealer.dealerPhone,
      },
    });

    return {
      data: shapeLoan(updated, {
        simulated: true,
        message: 'Simulated bureau check complete. Review and accept or decline the offer.',
      }),
    };
  },

  async respondToOffer(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');
    if (!['offer_ready', 'credit_checked'].includes(existing.status)) {
      return ctx.badRequest('No offer is waiting for a response');
    }

    const decision = trim(ctx.request.body?.data?.decision || ctx.request.body?.decision).toLowerCase();
    if (decision !== 'accept' && decision !== 'decline') {
      return ctx.badRequest('Choose accept or decline');
    }

    const accepted = decision === 'accept';
    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: accepted
        ? {
          status: 'documents_required',
          offerAcceptedAt: new Date(),
        }
        : {
          status: 'offer_declined',
          offerDeclinedAt: new Date(),
        },
    });

    return {
      data: shapeLoan(updated, {
        message: accepted
          ? 'Offer accepted. Proceed to documents to download terms and upload signed copies.'
          : 'Offer declined.',
      }),
    };
  },

  async agreement(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');

    const unlocked = [
      'documents_required',
      'documents_uploaded',
      'with_partners',
      'approved',
    ].includes(existing.status);
    if (!unlocked) {
      return ctx.badRequest('The terms document is not available yet');
    }

    const finance = await getFinanceSettings(strapi);
    const key = bankTermsKey(existing.bankName);
    const bankDoc = finance.carBankTermsDocuments?.[key];
    if (bankDoc?.url) {
      return {
        data: {
          title: bankDoc.name || `${existing.bankName || 'Bank'} terms and conditions`,
          fileName: bankDoc.fileName || `${key || 'bank'}-terms`,
          url: bankDoc.url,
          mimeType: bankDoc.mimeType || '',
          sample: false,
        },
      };
    }

    return {
      data: {
        title: 'Sample car finance terms and conditions',
        fileName: `movo-car-finance-terms-${existing.documentId || existing.id}.html`,
        html: agreementHtml(existing),
        sample: true,
      },
    };
  },

  async uploadDocuments(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id, {
      populate: ['user'],
    });
    if (!existing || !ownsLoan(existing, user)) return ctx.notFound('Loan application not found');
    if (!['documents_required', 'documents_uploaded'].includes(existing.status)) {
      return ctx.badRequest('Document upload is not open for this application yet');
    }

    const body = ctx.request.body?.data || ctx.request.body || {};
    const signedAgreementUrl = trim(body.signedAgreementUrl) || existing.signedAgreementUrl;
    const incoming = normalizeDocuments(body.supportingDocuments);
    const mergedByType = new Map();
    for (const item of normalizeDocuments(existing.supportingDocuments)) {
      mergedByType.set(trim(item.type || item.id), item);
    }
    for (const item of incoming) {
      mergedByType.set(trim(item.type || item.id), {
        type: trim(item.type || item.id),
        name: trim(item.name) || trim(item.type || item.id),
        url: trim(item.url),
        uploadedAt: item.uploadedAt || new Date().toISOString(),
      });
    }
    if (signedAgreementUrl) {
      mergedByType.set('signed_agreement', {
        type: 'signed_agreement',
        name: 'Signed loan terms and conditions',
        url: signedAgreementUrl,
        uploadedAt: new Date().toISOString(),
      });
    }

    const kyc = await findKycForUser(strapi, user);
    const finance = await getFinanceSettings(strapi);
    const applicantType = kyc?.applicantType === 'business' ? 'business' : 'individual';
    const required = requiredDocumentsFor(applicantType, finance.carRequiredDocuments);
    const documents = [...mergedByType.values()].filter((item) => item.url);
    const missing = required
      .filter((doc) => doc.required !== false)
      .filter((doc) => !documents.some((item) => item.type === doc.id))
      .map((doc) => doc.label);

    if (!signedAgreementUrl) {
      return ctx.badRequest('Upload the signed terms and conditions');
    }
    if (missing.length) {
      return ctx.badRequest(`Upload all required documents: ${missing.join(', ')}`);
    }

    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: {
        status: 'documents_uploaded',
        signedAgreementUrl,
        supportingDocuments: documents,
      },
    });

    return {
      data: shapeLoan(updated, {
        requiredDocuments: required,
        message: 'Documents submitted to the bank and dealer. Down payment and disbursement stay with the bank, not MOVO.',
      }),
    };
  },

  async updateStatus(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id);
    if (!existing) return ctx.notFound('Loan application not found');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const status = trim(body.status);
    if (!LOAN_STATUSES.has(status)) {
      return ctx.badRequest('Invalid loan application status');
    }

    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: { status },
    });

    return { data: updated };
  },

  async markDocumentsReady(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const existing = await findByIdOrDocumentId(strapi, LOAN_UID, ctx.params.id);
    if (!existing) return ctx.notFound('Loan application not found');
    if (!['awaiting_bank_inspection', 'offer_accepted', 'documents_required'].includes(existing.status)) {
      return ctx.badRequest('Unlock documents after the customer has accepted and the bank has inspected');
    }

    const updated = await strapi.entityService.update(LOAN_UID, existing.id, {
      data: { status: 'documents_required' },
    });

    return { data: shapeLoan(updated) };
  },

  async adminOverview(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const finance = await getFinanceSettings(strapi);
    const [listings, loans, inspections, prequalifications, kycs] = await Promise.all([
      strapi.entityService.findMany(PRODUCT_UID, {
        filters: carProductFilters(),
        populate: { seller: { fields: ['id', 'username', 'fullName', 'email', 'phone', 'location'] } },
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
      strapi.entityService.findMany(LOAN_UID, {
        populate: {
          product: { fields: ['id', 'documentId', 'name', 'category', 'priceUGX', 'yearOfManufacture'] },
          user: { fields: ['id', 'username', 'fullName', 'email', 'phone'] },
        },
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
      strapi.entityService.findMany(INSPECTION_UID, {
        populate: { user: { fields: ['id', 'username', 'fullName', 'email', 'phone'] } },
        sort: { createdAt: 'desc' },
        limit: 500,
      }),
      strapi.entityService.findMany(PREQUAL_UID, {
        sort: { createdAt: 'desc' },
        limit: 500,
      }).catch(() => []),
      strapi.entityService.findMany(KYC_UID, {
        populate: { user: { fields: ['id', 'username', 'fullName', 'email', 'phone'] } },
        sort: { updatedAt: 'desc' },
        limit: 500,
      }).catch(() => []),
    ]);

    const shapedListings = (listings || []).map((product) => ({
      id: product.documentId || product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      yearOfManufacture: product.yearOfManufacture,
      itemCondition: product.itemCondition || product.condition,
      priceUGX: product.priceUGX || 0,
      hirePurchaseMonthlyUGX: product.hirePurchaseMonthlyUGX || 0,
      hirePurchaseDepositPercent: product.hirePurchaseDepositPercent || 0,
      status: product.status,
      featuredImage: product.featuredImage || '',
      sellerName: product.seller?.fullName || product.seller?.username || '',
      sellerPhone: product.seller?.phone || product.paymentPhone || '',
      sellerLocation: product.seller?.location || '',
      createdAt: product.createdAt,
    }));

    return {
      data: {
        listings: shapedListings,
        loans: loans || [],
        inspections: inspections || [],
        prequalifications: prequalifications || [],
        kycs: kycs || [],
        finance,
        stats: {
          listings: shapedListings.length,
          activeListings: shapedListings.filter((row) => row.status === 'active').length,
          loans: (loans || []).length,
          newLoans: (loans || []).filter((row) => ['new', 'crb_fee_due'].includes(row.status)).length,
          inspections: (inspections || []).length,
          newInspections: (inspections || []).filter((row) => row.status === 'new').length,
          prequalifications: (prequalifications || []).length,
          newPrequalifications: (prequalifications || []).filter((row) => (row.followUpStatus || 'new') === 'new').length,
          pendingKyc: (kycs || []).filter((row) => row.status === 'pending').length,
        },
      },
    };
  },
}));
