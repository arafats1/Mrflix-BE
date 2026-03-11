'use strict';

const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = {
  /**
   * POST /api/password-reset/forgot
   * Sends a 6-digit reset code to the user's email via Resend.
   */
  async forgot(ctx) {
    const { email } = ctx.request.body;

    if (!email) {
      return ctx.badRequest('Email is required');
    }

    // Find user by email
    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: email.toLowerCase().trim() } });

    // Always return success to avoid email enumeration
    if (!user) {
      return { data: { message: 'If that email exists, a reset code has been sent.' } };
    }

    // Generate a 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store the code on the user (using the description field hack, or a custom field)
    // We'll store as JSON in resetPasswordToken field
    await strapi.db
      .query('plugin::users-permissions.user')
      .update({
        where: { id: user.id },
        data: {
          resetPasswordToken: JSON.stringify({ code, expiresAt: expiresAt.toISOString() }),
        },
      });

    // Send email via Resend
    try {
      await resend.emails.send({
        from: 'Mr.Flix <support@abramaccess.com>',
        to: user.email,
        subject: 'Mr.Flix - Password Reset Code',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0a0a0a; color: #fff; border-radius: 16px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #eab308; font-size: 24px; margin: 0;">Mr.Flix</h1>
            </div>
            <p style="color: #d1d5db; font-size: 15px; line-height: 1.6;">
              Hi <strong style="color: #fff;">${user.fullName || user.username}</strong>,
            </p>
            <p style="color: #d1d5db; font-size: 15px; line-height: 1.6;">
              You requested a password reset. Use the code below to reset your password:
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <div style="display: inline-block; background: #1a1a1a; border: 2px solid #eab308; border-radius: 12px; padding: 16px 40px; letter-spacing: 8px; font-size: 32px; font-weight: bold; color: #eab308;">
                ${code}
              </div>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              This code expires in <strong>15 minutes</strong>.
            </p>
            <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;" />
            <p style="color: #6b7280; font-size: 12px; text-align: center;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
        `,
      });

      strapi.log.info(`[Password Reset] Code sent to ${user.email}`);
    } catch (err) {
      strapi.log.error('[Password Reset] Failed to send email:', err);
      return ctx.badRequest('Failed to send reset email. Please try again.');
    }

    return { data: { message: 'If that email exists, a reset code has been sent.' } };
  },

  /**
   * POST /api/password-reset/reset
   * Validates the code and sets the new password.
   */
  async reset(ctx) {
    const { email, code, newPassword } = ctx.request.body;

    if (!email || !code || !newPassword) {
      return ctx.badRequest('Email, code, and new password are required');
    }

    if (newPassword.length < 6) {
      return ctx.badRequest('Password must be at least 6 characters');
    }

    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: email.toLowerCase().trim() } });

    if (!user || !user.resetPasswordToken) {
      return ctx.badRequest('Invalid or expired reset code');
    }

    // Parse the stored code
    let stored;
    try {
      stored = JSON.parse(user.resetPasswordToken);
    } catch {
      return ctx.badRequest('Invalid or expired reset code');
    }

    // Check expiry
    if (new Date() > new Date(stored.expiresAt)) {
      // Clear expired token
      await strapi.db
        .query('plugin::users-permissions.user')
        .update({ where: { id: user.id }, data: { resetPasswordToken: null } });
      return ctx.badRequest('Reset code has expired. Please request a new one.');
    }

    // Verify code (constant-time comparison)
    if (!crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(stored.code)))) {
      return ctx.badRequest('Invalid reset code');
    }

    // Hash and update password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await strapi.db
      .query('plugin::users-permissions.user')
      .update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
        },
      });

    strapi.log.info(`[Password Reset] Password updated for ${user.email}`);

    return { data: { message: 'Password has been reset successfully.' } };
  },
};
