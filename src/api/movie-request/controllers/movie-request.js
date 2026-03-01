'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::movie-request.movie-request', ({ strapi }) => ({
  // Users see only their own requests
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';

    // Update query filters manually instead of using super.find to avoid Strapi 5 validation bugs
    const query = {
      ...ctx.query,
      populate: ['requester'],
      sort: 'createdAt:desc',
    };

    if (!isAdmin) {
      query.filters = {
        ...query.filters,
        requester: { id: ctx.state.user.id },
      };
    }

    const entries = await strapi.entityService.findMany('api::movie-request.movie-request', query);
    return { data: entries };
  },

  // Create a new request
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const inputData = ctx.request.body.data || ctx.request.body;

    try {
      const entry = await strapi.entityService.create('api::movie-request.movie-request', {
        data: {
          title: inputData.title,
          description: inputData.description,
          type: inputData.type || 'movie',
          whatsappNumber: inputData.whatsappNumber,
          requester: ctx.state.user.id,
          status: 'pending',
        },
      });
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

    const entry = await strapi.entityService.update('api::movie-request.movie-request', id, {
      data: inputData,
    });
    return { data: entry };
  },
}));
