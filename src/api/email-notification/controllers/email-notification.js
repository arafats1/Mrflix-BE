'use strict';

const { sendContentUpdateEmail, sendSubscriptionExpiredEmail } = require('../../../utils/email');

module.exports = {
  /**
   * POST /api/email-notification/send-content-update
   * Admin sends bulk email with latest movies/series + optional message.
   * Body: { message?: string }
   */
  async sendContentUpdate(ctx) {
    const { message } = ctx.request.body || {};

    // Fetch latest 2 movies and 2 series (published, available)
    const latestMovies = await strapi.db.query('api::movie.movie').findMany({
      where: { type: 'movie', isAvailable: true, publishedAt: { $notNull: true } },
      orderBy: { createdAt: 'desc' },
      limit: 2,
    });

    const latestSeries = await strapi.db.query('api::movie.movie').findMany({
      where: { type: 'series', isAvailable: true, publishedAt: { $notNull: true } },
      orderBy: { createdAt: 'desc' },
      limit: 2,
    });

    if (latestMovies.length === 0 && latestSeries.length === 0 && !message) {
      return ctx.badRequest('No content to send — add movies/series first or include a message.');
    }

    // Get all confirmed, non-blocked users with emails
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { confirmed: true, blocked: { $ne: true } },
    });

    const emailUsers = users.filter(u => u.email);

    let sent = 0;
    let failed = 0;

    // Send in small batches to avoid rate limits
    for (const user of emailUsers) {
      try {
        await sendContentUpdateEmail({
          user,
          movies: latestMovies,
          series: latestSeries,
          message: message || '',
        });
        sent++;
      } catch (err) {
        failed++;
        strapi.log.error(`[BulkEmail] Failed for ${user.email}: ${err.message}`);
      }
    }

    strapi.log.info(`[BulkEmail] Content update sent: ${sent} success, ${failed} failed out of ${emailUsers.length}`);

    return {
      data: {
        totalUsers: emailUsers.length,
        sent,
        failed,
        moviesIncluded: latestMovies.map(m => m.title),
        seriesIncluded: latestSeries.map(s => s.title),
      },
    };
  },

  /**
   * POST /api/email-notification/test-expiry
   * Admin test: send subscription expired email to a specific email.
   * Body: { email: string }
   */
  async testExpiry(ctx) {
    const { email } = ctx.request.body || {};
    if (!email) return ctx.badRequest('Email is required');

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) return ctx.notFound('User not found with that email');

    try {
      await sendSubscriptionExpiredEmail(user);
      return { data: { message: `Expiry email sent to ${user.email}` } };
    } catch (err) {
      strapi.log.error(`[TestExpiry] Failed: ${err.message}`);
      return ctx.badRequest(`Failed to send: ${err.message}`);
    }
  },
};
