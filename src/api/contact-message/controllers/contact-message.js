'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::contact-message.contact-message', ({ strapi }) => ({
  // Public: create a contact message
  async create(ctx) {
    const { name, email, subject, message, category } = ctx.request.body.data || ctx.request.body;

    if (!name || !email || !subject || !message) {
      return ctx.badRequest('Missing required fields: name, email, subject, message');
    }

    const data = {
      name,
      email,
      subject,
      message,
      category: category || 'general',
      status: 'new',
      replies: [],
    };

    // Try to extract user from Bearer token if provided (auth: false skips auto-populate)
    const authHeader = ctx.request.header?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
        if (id) data.userId = id;
      } catch (_) {
        // token invalid — ignore, still allow public submission
      }
    }

    const entry = await strapi.entityService.create('api::contact-message.contact-message', { data });

    return { data: { id: entry.id, message: 'Your message has been sent successfully!' } };
  },

  // Authenticated user: get their own messages
  async myMessages(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const user = ctx.state.user;
    const entries = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters: {
        $or: [
          { userId: user.id },
          { email: user.email },
        ],
      },
      sort: { createdAt: 'desc' },
    });

    return { data: entries };
  },

  // Admin: reply to a contact message
  async reply(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    if (!isAdmin) {
      return ctx.forbidden('Only admins can reply to contact messages');
    }

    const { id } = ctx.params;
    const { message } = ctx.request.body.data || ctx.request.body;

    if (!message || !message.trim()) {
      return ctx.badRequest('Reply message is required');
    }

    // Resolve by documentId first, then fallback to numeric id
    let existing = null;
    const byDocId = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters: { documentId: id },
      limit: 1,
    });
    if (byDocId && byDocId.length > 0) {
      existing = byDocId[0];
    } else {
      try {
        existing = await strapi.entityService.findOne('api::contact-message.contact-message', id);
      } catch (_) {}
    }

    if (!existing) {
      return ctx.notFound('Message not found');
    }

    const replies = Array.isArray(existing.replies) ? existing.replies : [];
    replies.push({
      message: message.trim(),
      sender: 'admin',
      adminName: userWithRole.username || 'Admin',
      createdAt: new Date().toISOString(),
    });

    const updated = await strapi.entityService.update('api::contact-message.contact-message', existing.id, {
      data: { replies, status: 'replied' },
    });

    return { data: updated };
  },

  // Authenticated user: reply to their own message thread
  async userReply(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { id } = ctx.params;
    const { message } = ctx.request.body.data || ctx.request.body;

    if (!message || !message.trim()) {
      return ctx.badRequest('Reply message is required');
    }

    // Resolve by documentId first, then fallback to numeric id
    let existing = null;
    const byDocId = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters: { documentId: id },
      limit: 1,
    });
    if (byDocId && byDocId.length > 0) {
      existing = byDocId[0];
    } else {
      try {
        existing = await strapi.entityService.findOne('api::contact-message.contact-message', id);
      } catch (_) {}
    }

    if (!existing) {
      return ctx.notFound('Message not found');
    }

    // Verify ownership
    const user = ctx.state.user;
    if (existing.userId !== user.id && existing.email !== user.email) {
      return ctx.forbidden('You can only reply to your own messages');
    }

    const replies = Array.isArray(existing.replies) ? existing.replies : [];
    replies.push({
      message: message.trim(),
      sender: 'user',
      userName: user.username || existing.name,
      createdAt: new Date().toISOString(),
    });

    // If the message was replied/archived, set back to 'new' so admin sees it
    const updated = await strapi.entityService.update('api::contact-message.contact-message', existing.id, {
      data: { replies, status: 'new' },
    });

    return { data: updated };
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

    // Resolve by documentId first
    let entry = null;
    const byDocId = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters: { documentId: id },
      limit: 1,
    });
    if (byDocId && byDocId.length > 0) {
      entry = byDocId[0];
    } else {
      try {
        entry = await strapi.entityService.findOne('api::contact-message.contact-message', id);
      } catch (_) {}
    }

    if (!entry) return ctx.notFound('Message not found');

    const updated = await strapi.entityService.update('api::contact-message.contact-message', entry.id, {
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

    // Resolve by documentId first
    let entry = null;
    const byDocId = await strapi.entityService.findMany('api::contact-message.contact-message', {
      filters: { documentId: id },
      limit: 1,
    });
    if (byDocId && byDocId.length > 0) {
      entry = byDocId[0];
    } else {
      try {
        entry = await strapi.entityService.findOne('api::contact-message.contact-message', id);
      } catch (_) {}
    }

    if (!entry) return ctx.notFound('Message not found');

    await strapi.entityService.delete('api::contact-message.contact-message', entry.id);

    return { data: { message: 'Deleted' } };
  },
}));
