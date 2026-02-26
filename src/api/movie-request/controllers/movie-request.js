'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::movie-request.movie-request', ({ strapi }) => ({
  // Users see only their own requests
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Admin sees all requests
    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';

    if (!isAdmin) {
      ctx.query = {
        ...ctx.query,
        filters: {
          ...ctx.query.filters,
          requester: ctx.state.user.id,
        },
      };
    }

    ctx.query = {
      ...ctx.query,
      populate: ['requester'],
      sort: { createdAt: 'desc' },
    };

    const { data, meta } = await super.find(ctx);
    return { data, meta };
  },

  // Create a new request
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const body = ctx.request.body.data || ctx.request.body;

    ctx.request.body = {
      data: {
        ...body,
        requester: ctx.state.user.id,
        status: 'pending',
      },
    };

    const response = await super.create(ctx);
    return response;
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

    const response = await super.update(ctx);
    return response;
  },
}));
