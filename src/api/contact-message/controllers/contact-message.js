'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::contact-message.contact-message', ({ strapi }) => ({
  // Public: create a contact message
  async create(ctx) {
    const { name, email, subject, message, category } = ctx.request.body.data || ctx.request.body;

    if (!name || !email || !subject || !message) {
      return ctx.badRequest('Missing required fields: name, email, subject, message');
    }

    const entry = await strapi.entityService.create('api::contact-message.contact-message', {
      data: {
        name,
        email,
        subject,
        message,
        category: category || 'general',
        status: 'new',
      },
    });

    return { data: { id: entry.id, message: 'Your message has been sent successfully!' } };
  },

  // Admin: list all contact messages
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    if (!isAdmin) {
      return ctx.forbidden('Only admins can view contact messages');
    }

    const { status, category } = ctx.query;
    const filters = {};
    if (status) filters.status = status;
    if (category) filters.category = category;

    const entries = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters,
      sort: { createdAt: 'desc' },
    });

    return { data: entries, meta: { total: entries.length } };
  },

  // Admin: update status of a contact message
  async update(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    if (!isAdmin) {
      return ctx.forbidden('Only admins can update contact messages');
    }

    const { id } = ctx.params;
    const { status } = ctx.request.body.data || ctx.request.body;

    const updated = await strapi.entityService.update('api::contact-message.contact-message', id, {
      data: { status },
    });

    return { data: updated };
  },

  // Admin: delete a contact message
  async delete(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    if (!isAdmin) {
      return ctx.forbidden('Only admins can delete contact messages');
    }

    const { id } = ctx.params;
    await strapi.entityService.delete('api::contact-message.contact-message', id);

    return { data: { message: 'Deleted' } };
  },
}));
