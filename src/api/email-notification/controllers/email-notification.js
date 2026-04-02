'use strict';

const { sendContentUpdateEmail, sendSubscriptionExpiredEmail } = require('../../../utils/email');

module.exports = {
  /**
   * POST /api/email-notification/send-content-update
   * Admin sends bulk email with latest movies/series + optional message.
   * Body: { message?: string }
   */
  async sendContentUpdate(ctx) {
    const { message, movieIds, seriesIds } = ctx.request.body || {};

    // Fetch admin-selected movies by documentId (Strapi v5 external UID)
    let selectedMovies = [];
    if (Array.isArray(movieIds) && movieIds.length > 0) {
      selectedMovies = await strapi.db.query('api::movie.movie').findMany({
        where: { documentId: { $in: movieIds }, isAvailable: true, publishedAt: { $notNull: true } },
      });
    }

    // Fetch admin-selected series by documentId (Strapi v5 external UID)
    let selectedSeries = [];
    if (Array.isArray(seriesIds) && seriesIds.length > 0) {
      selectedSeries = await strapi.db.query('api::movie.movie').findMany({
        where: { documentId: { $in: seriesIds }, isAvailable: true, publishedAt: { $notNull: true } },
      });
    }

    if (selectedMovies.length === 0 && selectedSeries.length === 0 && !message) {
      return ctx.badRequest('Please select at least one movie or series, or include a custom message.');
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
          movies: selectedMovies,
          series: selectedSeries,
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
        moviesIncluded: selectedMovies.map(m => m.title),
        seriesIncluded: selectedSeries.map(s => s.title),
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
