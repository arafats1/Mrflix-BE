module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'http://localhost:1337'),
  proxy: env.bool('TRUST_PROXY', false),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: true,
    tasks: {
      // Check for expired subscriptions every day at 8 AM
      '0 8 * * *': async ({ strapi }) => {
        try {
          const { sendSubscriptionExpiredEmail } = require('../src/utils/email');
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

          // Find subscriptions that expired in the last 24 hours
          const expired = await strapi.db.query('api::subscription.subscription').findMany({
            where: {
              status: 'active',
              endDate: { $lte: now.toISOString() },
            },
            populate: ['subscriber'],
          });

          let sent = 0;
          for (const sub of expired) {
            // Mark as expired
            await strapi.db.query('api::subscription.subscription').update({
              where: { id: sub.id },
              data: { status: 'expired' },
            });

            // Send email if user has one
            if (sub.subscriber?.email) {
              try {
                await sendSubscriptionExpiredEmail(sub.subscriber);
                sent++;
                strapi.log.info(`[Cron] Expiry email sent to ${sub.subscriber.email}`);
              } catch (emailErr) {
                strapi.log.error(`[Cron] Failed to send expiry email to ${sub.subscriber.email}:`, emailErr.message);
              }
            }
          }

          if (expired.length > 0) {
            strapi.log.info(`[Cron] Processed ${expired.length} expired subs, sent ${sent} emails`);
          }
        } catch (err) {
          strapi.log.error('[Cron] Subscription expiry check failed:', err.message);
        }
      },
    },
  },
});
