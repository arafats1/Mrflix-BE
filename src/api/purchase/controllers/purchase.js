'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const pesapal = require('../../../utils/pesapal');

module.exports = createCoreController('api::purchase.purchase', ({ strapi }) => ({
  // Users see their own purchases, admins see all with buyer info
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    const filters = {};
    if (!isAdmin) {
      filters.buyer = { id: ctx.state.user.id };
    }

    const populate = isAdmin
      ? { movie: { populate: '*' }, buyer: { populate: '*' } }
      : { movie: { populate: '*' } };

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters,
      populate,
      sort: { createdAt: 'desc' },
    });

    return { data: purchases, meta: { pagination: { total: purchases.length } } };
  },

  /**
   * Create a purchase — initiates Pesapal payment.
   * Returns a redirect_url the frontend should open.
   */
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId, paymentMethod, paymentPhone, seasonNumber } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    // Get the movie
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Determine filter for existing purchase
    const filters = {
      buyer: { id: ctx.state.user.id },
      movie: { id: movie.id },
      status: 'completed',
    };

    if (movie.type === 'series' && seasonNumber) {
      filters.seasonNumber = parseInt(seasonNumber);
    }

    // Check if already purchased
    const existing = await strapi.documents('api::purchase.purchase').findMany({
      filters,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already own this ' + (seasonNumber ? `season ${seasonNumber}` : 'movie'));
    }

    // Determine the correct price from site settings
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const amount = movie.type === 'series'
      ? (settings?.seriesPrice ?? 5000)
      : (settings?.moviePrice ?? 2000);

    // Generate unique merchant reference
    const merchantReference = `PUR_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Get the registered IPN ID from site settings
    const ipnId = settings?.pesapalIpnId;
    if (!ipnId) {
      strapi.log.error('Pesapal IPN ID not configured.');
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callbackUrl = `${frontendUrl}/payment/callback`;
    const description = seasonNumber
      ? `${movie.title} - Season ${seasonNumber}`
      : movie.title;

    // Create a pending purchase record
    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: {
        movie: movie.id,
        buyer: ctx.state.user.id,
        amount,
        paymentMethod: paymentMethod || 'pesapal',
        paymentPhone: paymentPhone || '',
        transactionId: merchantReference,
        status: 'pending',
        seasonNumber: (movie.type === 'series' && seasonNumber) ? seasonNumber : null,
      },
    });

    // Submit order to Pesapal
    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const pesapalOrder = await pesapal.submitOrder({
        merchantReference,
        amount,
        description: `Mr.Flix - ${description}`,
        callbackUrl,
        ipnId,
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      // Store the Pesapal order tracking ID on the purchase
      await strapi.documents('api::purchase.purchase').update({
        documentId: purchase.documentId,
        data: { pesapalTrackingId: pesapalOrder.order_tracking_id },
      });

      return {
        data: {
          purchaseId: purchase.documentId,
          transactionId: merchantReference,
          redirect_url: pesapalOrder.redirect_url,
          order_tracking_id: pesapalOrder.order_tracking_id,
        },
      };
    } catch (err) {
      strapi.log.error('Pesapal order submission failed:', err);
      await strapi.documents('api::purchase.purchase').update({
        documentId: purchase.documentId,
        data: { status: 'failed' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  /**
   * Bulk purchase — for cart checkout.
   * Creates pending purchases for all movies, submits one combined Pesapal order.
   */
  async createBulk(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieIds, paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;

    if (!movieIds || !Array.isArray(movieIds) || movieIds.length === 0) {
      return ctx.badRequest('Missing required field: movieIds (array)');
    }

    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const ipnId = settings?.pesapalIpnId;
    if (!ipnId) {
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }

    let totalAmount = 0;
    const purchaseIds = [];
    const titles = [];
    const merchantReference = `CART_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    for (const movieId of movieIds) {
      const movie = await strapi.documents('api::movie.movie').findOne({ documentId: movieId });
      if (!movie) continue;

      const existing = await strapi.documents('api::purchase.purchase').findMany({
        filters: { buyer: { id: ctx.state.user.id }, movie: { id: movie.id }, status: 'completed' },
      });
      if (existing && existing.length > 0) continue;

      const amount = movie.type === 'series'
        ? (settings?.seriesPrice ?? 5000)
        : (settings?.moviePrice ?? 2000);

      totalAmount += amount;
      titles.push(movie.title);

      const purchase = await strapi.documents('api::purchase.purchase').create({
        data: {
          movie: movie.id,
          buyer: ctx.state.user.id,
          amount,
          paymentMethod: paymentMethod || 'pesapal',
          paymentPhone: paymentPhone || '',
          transactionId: merchantReference,
          status: 'pending',
        },
      });
      purchaseIds.push(purchase.documentId);
    }

    if (totalAmount === 0) {
      return ctx.badRequest('No new movies to purchase');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const pesapalOrder = await pesapal.submitOrder({
        merchantReference,
        amount: totalAmount,
        description: `Mr.Flix - ${titles.length} title(s): ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '...' : ''}`,
        callbackUrl: `${frontendUrl}/payment/callback`,
        ipnId,
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      for (const pid of purchaseIds) {
        await strapi.documents('api::purchase.purchase').update({
          documentId: pid,
          data: { pesapalTrackingId: pesapalOrder.order_tracking_id },
        });
      }

      return {
        data: {
          purchaseIds,
          transactionId: merchantReference,
          redirect_url: pesapalOrder.redirect_url,
          order_tracking_id: pesapalOrder.order_tracking_id,
          totalAmount,
        },
      };
    } catch (err) {
      strapi.log.error('Pesapal bulk order failed:', err);
      for (const pid of purchaseIds) {
        await strapi.documents('api::purchase.purchase').update({
          documentId: pid,
          data: { status: 'failed' },
        });
      }
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  /**
   * Check the status of a pending purchase by transactionId.
   * If still pending, actively queries Pesapal to see if payment completed
   * (handles case where IPN hasn't arrived, e.g. localhost or network issues).
   */
  async checkStatus(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { transactionId } = ctx.params;
    if (!transactionId) {
      return ctx.badRequest('Missing transactionId');
    }

    let purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        transactionId,
        buyer: { id: ctx.state.user.id },
      },
      populate: { movie: true },
    });

    if (!purchases || purchases.length === 0) {
      strapi.log.info(`[checkStatus] No purchases found for txn=${transactionId} user=${ctx.state.user.id}`);
      return ctx.notFound('Purchase not found');
    }

    // If any purchase is still pending, check Pesapal directly
    const hasPending = purchases.some(p => p.status === 'pending');
    strapi.log.info(`[checkStatus] txn=${transactionId} found=${purchases.length} hasPending=${hasPending} pesapalId=${purchases[0].pesapalTrackingId || 'none'}`);
    if (hasPending) {
      const trackingId = purchases[0].pesapalTrackingId;
      if (trackingId) {
        try {
          const status = await pesapal.getTransactionStatus(trackingId);
          const paymentStatus = (status.payment_status_description || '').toLowerCase();
          strapi.log.info(`[checkStatus] Pesapal says: ${paymentStatus} (raw: ${JSON.stringify(status)})`);

          if (paymentStatus === 'completed') {
            for (const p of purchases) {
              if (p.status === 'pending') {
                await strapi.documents('api::purchase.purchase').update({
                  documentId: p.documentId,
                  data: { status: 'completed', pesapalTrackingId: trackingId },
                });
              }
            }
            // Re-fetch with updated status
            purchases = await strapi.documents('api::purchase.purchase').findMany({
              filters: { transactionId, buyer: { id: ctx.state.user.id } },
              populate: { movie: true },
            });
          } else if (paymentStatus === 'failed' || paymentStatus === 'invalid') {
            for (const p of purchases) {
              if (p.status === 'pending') {
                await strapi.documents('api::purchase.purchase').update({
                  documentId: p.documentId,
                  data: { status: 'failed' },
                });
              }
            }
            purchases = await strapi.documents('api::purchase.purchase').findMany({
              filters: { transactionId, buyer: { id: ctx.state.user.id } },
              populate: { movie: true },
            });
          }
        } catch (err) {
          strapi.log.warn('[checkStatus] Pesapal query failed:', err.message);
        }
      }
    }

    return {
      data: purchases.map(p => ({
        id: p.documentId,
        status: p.status,
        movieInfo: p.movie ? { id: p.movie.documentId || p.movie.id, title: p.movie.title, type: p.movie.type } : null,
      })),
    };
  },

  async incrementDownload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing movieId');
    }

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: ctx.state.user.id,
        movie: { documentId: movieId },
        status: 'completed',
      },
      sort: { createdAt: 'desc' },
      limit: 1,
    });

    if (!purchases || purchases.length === 0) {
      return ctx.notFound('Purchase record not found for this user and movie');
    }

    const purchase = purchases[0];

    const updated = await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: {
        downloadCount: (purchase.downloadCount || 0) + 1,
      },
    });

    return { data: updated };
  },
}));
