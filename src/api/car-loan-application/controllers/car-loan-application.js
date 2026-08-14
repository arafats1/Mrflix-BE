'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const { carProductFilters, findByIdOrDocumentId } = require('../../../utils/cars');

const LOAN_UID = 'api::car-loan-application.car-loan-application';
const INSPECTION_UID = 'api::car-inspection-booking.car-inspection-booking';
const PREQUAL_UID = 'api::car-prequalification.car-prequalification';
const PRODUCT_UID = 'api::product.product';
const LOAN_STATUSES = new Set(['new', 'reviewing', 'approved', 'declined', 'archived']);
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

async function resolveProduct(strapi, id) {
  const raw = trim(id);
  if (!raw) return null;
  const byDocumentId = await strapi.db.query('api::product.product').findOne({
    where: { documentId: raw },
  });
  if (byDocumentId) return byDocumentId;
  if (/^\d+$/.test(raw)) {
    return strapi.db.query('api::product.product').findOne({
      where: { id: Number(raw) },
    });
  }
  return null;
}

module.exports = createCoreController('api::car-loan-application.car-loan-application', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const user = await resolveAuthUser(strapi, ctx);

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

    const data = {
      status: 'new',
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
    };

    if (product?.id) data.product = product.id;
    if (user?.id) data.user = user.id;

    const entry = await strapi.entityService.create('api::car-loan-application.car-loan-application', { data });

    return {
      data: {
        id: entry.id,
        documentId: entry.documentId,
        message: 'Your loan application has been submitted.',
      },
    };
  },

  async mine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const entries = await strapi.entityService.findMany('api::car-loan-application.car-loan-application', {
      filters: {
        $or: [
          { user: { id: user.id } },
          { email: user.email },
        ],
      },
      sort: { createdAt: 'desc' },
    });

    return { data: entries };
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

  async adminOverview(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const [listings, loans, inspections, prequalifications] = await Promise.all([
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
        stats: {
          listings: shapedListings.length,
          activeListings: shapedListings.filter((row) => row.status === 'active').length,
          loans: (loans || []).length,
          newLoans: (loans || []).filter((row) => row.status === 'new').length,
          inspections: (inspections || []).length,
          newInspections: (inspections || []).filter((row) => row.status === 'new').length,
          prequalifications: (prequalifications || []).length,
          newPrequalifications: (prequalifications || []).filter((row) => (row.followUpStatus || 'new') === 'new').length,
        },
      },
    };
  },
}));
