'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { assertAdmin } = require('../../../utils/admin-auth');
const { findByIdOrDocumentId } = require('../../../utils/cars');

const UID = 'api::car-prequalification.car-prequalification';
const EMPLOYMENT = new Set(['salary', 'business']);
const FOLLOW_UP = new Set(['new', 'contacted', 'closed']);

function trim(value) {
  return String(value ?? '').trim();
}

function toInt(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeUgPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('256')) return digits;
  return digits ? `256${digits}` : '';
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const user = await resolveAuthUser(strapi, ctx);
    const firstName = trim(body.firstName);
    const lastName = trim(body.lastName);
    const phone = normalizeUgPhone(body.phone);
    const email = trim(body.email).toLowerCase();
    const employmentType = trim(body.employmentType);
    const monthlyIncomeUGX = toInt(body.monthlyIncomeUGX);
    const loanTermMonths = toInt(body.loanTermMonths);

    if (!firstName || !lastName || !phone || !email || !EMPLOYMENT.has(employmentType) || monthlyIncomeUGX <= 0 || loanTermMonths <= 0) {
      return ctx.badRequest('Missing required pre-qualification fields');
    }

    const entry = await strapi.entityService.create(UID, {
      data: {
        firstName,
        lastName,
        phone,
        email,
        employmentType,
        monthlyIncomeUGX,
        loanTermMonths,
        maxFinanceUGX: toInt(body.maxFinanceUGX) || null,
        minEquityUGX: toInt(body.minEquityUGX) || null,
        maxMonthlyUGX: toInt(body.maxMonthlyUGX) || null,
        followUpStatus: 'new',
        ...(user?.id ? { user: user.id } : {}),
      },
    });

    return { data: { id: entry.id, documentId: entry.documentId } };
  },

  async updateStatus(ctx) {
    const admin = await assertAdmin(ctx, strapi);
    if (!admin) return;

    const existing = await findByIdOrDocumentId(strapi, UID, ctx.params.id);
    if (!existing) return ctx.notFound('Pre-qualification not found');

    const body = ctx.request.body?.data || ctx.request.body || {};
    const followUpStatus = trim(body.followUpStatus || body.status);
    if (!FOLLOW_UP.has(followUpStatus)) {
      return ctx.badRequest('Invalid follow-up status');
    }

    const updated = await strapi.entityService.update(UID, existing.id, {
      data: { followUpStatus },
    });

    return { data: updated };
  },
}));
