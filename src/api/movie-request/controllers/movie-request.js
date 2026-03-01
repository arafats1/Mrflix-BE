'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { notifyAdminNewRequest, notifyUserMovieAvailable } = require('../../../utils/whatsapp');

module.exports = createCoreController('api::movie-request.movie-request', ({ strapi }) => ({
  // Users see only their own requests
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';

    const params = {
      populate: {
        requester: true,
      },
      sort: 'createdAt:desc',
    };

    if (!isAdmin) {
      params.filters = {
        requester: { id: ctx.state.user.id },
      };
    }

    const entries = await strapi.documents('api::movie-request.movie-request').findMany(params);
    return { data: entries };
  },

  // Create a new request
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const inputData = ctx.request.body.data || ctx.request.body;

    try {
      const entry = await strapi.documents('api::movie-request.movie-request').create({
        data: {
          title: inputData.title,
          description: inputData.description,
          type: inputData.type || 'movie',
          whatsappNumber: inputData.whatsappNumber,
          requester: ctx.state.user.id,
          status: 'pending',
        },
      });

      // Send WhatsApp alert to admin (fire-and-forget)
      notifyAdminNewRequest({
        title: inputData.title,
        type: inputData.type || 'movie',
        requesterName: ctx.state.user.fullName || ctx.state.user.username || 'Unknown',
        whatsappNumber: inputData.whatsappNumber,
      }).catch(err => console.error('[WhatsApp] Admin notify failed:', err.message));

      return { data: entry };
    } catch (err) {
      console.error('Request Create Error:', err.message);
      ctx.throw(400, err.message);
    }
  },

  // Update request status (admin only)
  async update(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can update request status');
    }

    const { id } = ctx.params;
    const inputData = ctx.request.body.data || ctx.request.body;

    // Fetch current entry by documentId to get whatsapp number and requester
    const existing = await strapi.documents('api::movie-request.movie-request').findOne({
      documentId: id,
      populate: { requester: true },
    });

    if (!existing) {
      return ctx.notFound('Request not found');
    }

    // Update using documentId
    const entry = await strapi.documents('api::movie-request.movie-request').update({
      documentId: id,
      data: inputData,
    });

    // If marked as available, notify the user via WhatsApp
    if (inputData.status === 'available') {
      const userWhatsApp = existing.whatsappNumber || existing.requester?.phone;
      if (userWhatsApp) {
        notifyUserMovieAvailable({
          to: userWhatsApp,
          title: existing.title,
          adminNote: inputData.adminNote || existing.adminNote,
        }).catch(err => console.error('[WhatsApp] User notify failed:', err.message));
      }
    }

    return { data: entry };
  },
}));
