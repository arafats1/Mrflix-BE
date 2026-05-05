'use strict';

const crypto = require('crypto');
const { sendSms } = require('../../../utils/sms');

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    documentId: user.documentId,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    phoneVerified: !!user.phoneVerified,
    confirmed: !!user.confirmed,
    blocked: !!user.blocked,
    fullName: user.fullName || null,
    provider: user.provider,
  };
}

function normalizeUgPhone(phone) {
  if (!phone) return '';
  let p = String(phone).trim().replace(/[\s()+-]/g, '');
  if (p.startsWith('0')) p = `256${p.slice(1)}`;
  return p;
}

async function findUserByPhone(phone) {
  const normalized = normalizeUgPhone(phone);
  if (!normalized) return null;

  // Phone is stored normalized via the register extension.
  return strapi.db
    .query('plugin::users-permissions.user')
    .findOne({ where: { phone: normalized } });
}

module.exports = {
  /**
   * POST /api/phone-verification/send
   * Body: { phone }
   * Sends a 6-digit OTP via SMS.
   */
  async send(ctx) {
    const { phone } = ctx.request.body || {};
    if (!phone) return ctx.badRequest('Phone is required');

    const user = await findUserByPhone(phone);
    // Don't leak existence
    if (!user) {
      return { data: { message: 'If that phone exists, a verification code has been sent.' } };
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        phoneOtpToken: JSON.stringify({ code, expiresAt: expiresAt.toISOString() }),
      },
    });

    try {
      await sendSms({
        to: user.phone,
        message: `Your Mr.Flix verification code is ${code}. It expires in 10 minutes.`,
      });
    } catch (err) {
      strapi.log.error('[PhoneVerification] SMS send failed:', err.message);
      return ctx.badRequest('Failed to send SMS. Please try again.');
    }

    return { data: { message: 'Verification code sent.' } };
  },

  /**
   * POST /api/phone-verification/verify
   * Body: { phone, code }
   */
  async verify(ctx) {
    const { phone, code } = ctx.request.body || {};
    if (!phone || !code) return ctx.badRequest('Phone and code are required');

    const user = await findUserByPhone(phone);
    if (!user || !user.phoneOtpToken) {
      return ctx.badRequest('Invalid or expired code');
    }

    let stored;
    try {
      stored = JSON.parse(user.phoneOtpToken);
    } catch {
      return ctx.badRequest('Invalid or expired code');
    }

    if (new Date() > new Date(stored.expiresAt)) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { phoneOtpToken: null },
      });
      return ctx.badRequest('Code has expired. Please request a new one.');
    }

    const a = Buffer.from(String(code));
    const b = Buffer.from(String(stored.code));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return ctx.badRequest('Invalid code');
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        phoneVerified: true,
        phoneOtpToken: null,
        confirmed: true,
      },
    });

    const authenticatedUser = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: user.id }, populate: ['role'] });
    const jwt = await strapi
      .plugin('users-permissions')
      .service('jwt')
      .issue({ id: user.id });

    return {
      data: {
        message: 'Phone verified successfully.',
        phoneVerified: true,
        jwt,
        user: sanitizeUser(authenticatedUser),
      },
    };
  },
};
