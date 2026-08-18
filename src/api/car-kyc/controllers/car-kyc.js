'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const { findByIdOrDocumentId } = require('../../../utils/cars');
const { findCarKycForUser } = require('../../../utils/car-kyc');

const UID = 'api::car-kyc.car-kyc';
const APPLICANT_TYPES = new Set(['individual', 'business']);
const KYC_STATUSES = new Set(['draft', 'pending', 'approved', 'rejected']);

function trim(value) {
  return String(value ?? '').trim();
}

function isComplete(data) {
  if (data.applicantType === 'business') {
    return Boolean(
      trim(data.fullName)
      && trim(data.phone)
      && trim(data.contactEmail)
      && trim(data.businessName)
      && trim(data.registrationNumber)
      && trim(data.tin)
      && trim(data.businessCertificateUrl)
    );
  }
  if (!trim(data.fullName) || !trim(data.nationalId) || !trim(data.dateOfBirth) || !trim(data.phone) || !trim(data.address)) {
    return false;
  }
  return Boolean(trim(data.idFrontUrl) && trim(data.idBackUrl));
}

function shape(entry) {
  if (!entry) return null;
  return {
    id: entry.documentId || entry.id,
    applicantType: entry.applicantType || 'individual',
    status: entry.status || 'draft',
    fullName: entry.fullName || '',
    nationalId: entry.nationalId || '',
    dateOfBirth: entry.dateOfBirth || '',
    nationality: entry.nationality || '',
    phone: entry.phone || '',
    contactEmail: entry.contactEmail || '',
    address: entry.address || '',
    idFrontUrl: entry.idFrontUrl || '',
    idBackUrl: entry.idBackUrl || '',
    selfieUrl: entry.selfieUrl || '',
    businessName: entry.businessName || '',
    registrationNumber: entry.registrationNumber || '',
    tin: entry.tin || '',
    businessCertificateUrl: entry.businessCertificateUrl || '',
    tinCertificateUrl: entry.tinCertificateUrl || '',
    notes: entry.notes || '',
    reviewedAt: entry.reviewedAt || null,
    complete: isComplete(entry),
    updatedAt: entry.updatedAt,
  };
}

async function findMine(strapi, user) {
  return findCarKycForUser(strapi, user);
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async mine(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');
    ctx.body = { data: shape(await findMine(strapi, user)) };
  },

  async upsert(ctx) {
    const user = await resolveAuthUser(strapi, ctx);
    if (!user) return ctx.unauthorized('You must be logged in');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const applicantType = APPLICANT_TYPES.has(trim(body.applicantType)) ? trim(body.applicantType) : 'individual';
    const submit = body.submit === true || body.submit === 'true';

    const data = {
      applicantType,
      fullName: trim(body.fullName) || trim(user.fullName),
      nationalId: trim(body.nationalId).toUpperCase(),
      dateOfBirth: trim(body.dateOfBirth) || null,
      nationality: trim(body.nationality) || 'Ugandan',
      phone: trim(body.phone) || trim(user.phone),
      contactEmail: trim(body.contactEmail || body.email).toLowerCase() || trim(user.email).toLowerCase(),
      address: trim(body.address),
      idFrontUrl: trim(body.idFrontUrl),
      idBackUrl: trim(body.idBackUrl),
      selfieUrl: trim(body.selfieUrl),
      businessName: trim(body.businessName),
      registrationNumber: trim(body.registrationNumber),
      tin: trim(body.tin),
      businessCertificateUrl: trim(body.businessCertificateUrl),
      tinCertificateUrl: trim(body.tinCertificateUrl),
      user: user.id,
    };

    if (submit && !isComplete({ ...data, applicantType })) {
      return ctx.badRequest(
        applicantType === 'business'
          ? 'Enter the contact person, email, phone, and company documents to submit KYB'
          : 'Complete KYC details and upload both sides of your National ID to submit',
      );
    }

    if (submit) data.status = 'pending';

    const existing = await findMine(strapi, user);
    let entry;
    if (existing) {
      if (!submit) data.status = existing.status;
      entry = await strapi.entityService.update(UID, existing.id, { data });
    } else {
      data.status = submit ? 'pending' : 'draft';
      data.user = user.id;
      entry = await strapi.entityService.create(UID, { data });
    }

    ctx.body = { data: shape(entry) };
  },

  async adminList(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;
    const rows = await strapi.entityService.findMany(UID, {
      populate: { user: { fields: ['id', 'username', 'fullName', 'email', 'phone'] } },
      sort: { updatedAt: 'desc' },
      limit: 500,
    });
    return {
      data: (rows || []).map((row) => ({
        ...shape(row),
        user: row.user || null,
      })),
    };
  },

  async review(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;
    const existing = await findByIdOrDocumentId(strapi, UID, ctx.params.id);
    if (!existing) return ctx.notFound('KYC record not found');
    const status = trim(ctx.request.body?.data?.status || ctx.request.body?.status);
    if (!KYC_STATUSES.has(status) || status === 'draft') {
      return ctx.badRequest('Invalid KYC status');
    }
    const notes = trim(ctx.request.body?.data?.notes || ctx.request.body?.notes);
    const updated = await strapi.entityService.update(UID, existing.id, {
      data: {
        status,
        notes: notes || existing.notes,
        reviewedAt: new Date(),
        reviewerName: admin.fullName || admin.username || 'Admin',
      },
    });
    return { data: shape(updated) };
  },
}));
