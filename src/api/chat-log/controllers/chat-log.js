'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::chat-log.chat-log', ({ strapi }) => ({
  /**
   * Public: Save or update a chat conversation.
   * Called by the frontend after each AI response.
   */
  async save(ctx) {
    const { sessionId, messages, userName, userEmail, userId } = ctx.request.body;

    if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
      return ctx.badRequest('sessionId and messages are required');
    }

    // Determine guest status
    const isGuest = !userId;

    // Get last user message for quick preview
    const userMessages = messages.filter(m => m.role === 'user');
    const lastMessage = userMessages.length > 0
      ? userMessages[userMessages.length - 1].content?.substring(0, 500)
      : '';

    // Sanitize messages — only keep role + content
    const sanitizedMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: String(m.content).substring(0, 2000) }));

    const ip = ctx.request.ip || ctx.request.header['x-forwarded-for'] || '';
    const userAgent = (ctx.request.header['user-agent'] || '').substring(0, 500);

    try {
      // Check if session already exists — update it
      const existing = await strapi.entityService.findMany('api::chat-log.chat-log', {
        filters: { sessionId },
        limit: 1,
      });

      if (existing && existing.length > 0) {
        const entry = existing[0];
        const updated = await strapi.entityService.update('api::chat-log.chat-log', entry.id, {
          data: {
            messages: sanitizedMessages,
            messageCount: sanitizedMessages.filter(m => m.role === 'user').length,
            lastMessage,
            // Update user info if they logged in mid-conversation
            ...(userName && { userName }),
            ...(userEmail && { userEmail }),
            ...(userId && { userId, isGuest: false }),
          },
        });
        return { data: { id: updated.documentId || updated.id } };
      }

      // Create new chat log
      const entry = await strapi.entityService.create('api::chat-log.chat-log', {
        data: {
          sessionId,
          messages: sanitizedMessages,
          messageCount: sanitizedMessages.filter(m => m.role === 'user').length,
          lastMessage,
          userName: userName || null,
          userEmail: userEmail || null,
          userId: userId || null,
          isGuest,
          ipAddress: ip,
          userAgent,
        },
      });

      return { data: { id: entry.documentId || entry.id } };
    } catch (err) {
      strapi.log.error('Chat log save error:', err);
      return ctx.badRequest('Failed to save chat log');
    }
  },

  /**
   * Admin: List all chat logs
   */
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
      return ctx.forbidden('Only admins can view chat logs');
    }

    const { isGuest, search } = ctx.query;
    const filters = {};
    if (isGuest === 'true') filters.isGuest = true;
    if (isGuest === 'false') filters.isGuest = false;

    if (search) {
      filters.$or = [
        { userName: { $containsi: search } },
        { userEmail: { $containsi: search } },
        { lastMessage: { $containsi: search } },
        { sessionId: { $containsi: search } },
      ];
    }

    const entries = await strapi.entityService.findMany('api::chat-log.chat-log', {
      filters,
      sort: { updatedAt: 'desc' },
      limit: 200,
    });

    return { data: entries, meta: { total: entries.length } };
  },

  /**
   * Admin: Get a single chat log with full messages
   */
  async findOne(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can view chat logs');
    }

    const { id } = ctx.params;

    const entry = await strapi.entityService.findMany('api::chat-log.chat-log', {
      filters: { documentId: id },
      limit: 1,
    });

    if (!entry || entry.length === 0) {
      // Try by numeric id
      try {
        const byId = await strapi.entityService.findOne('api::chat-log.chat-log', id);
        if (byId) return { data: byId };
      } catch {}
      return ctx.notFound('Chat log not found');
    }

    return { data: entry[0] };
  },

  /**
   * Admin: Delete a chat log
   */
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
      return ctx.forbidden('Only admins can delete chat logs');
    }

    const { id } = ctx.params;

    try {
      // Try documentId first
      const entries = await strapi.entityService.findMany('api::chat-log.chat-log', {
        filters: { documentId: id },
        limit: 1,
      });

      if (entries && entries.length > 0) {
        await strapi.entityService.delete('api::chat-log.chat-log', entries[0].id);
        return { data: { message: 'Deleted' } };
      }

      // Fallback to numeric id
      await strapi.entityService.delete('api::chat-log.chat-log', id);
      return { data: { message: 'Deleted' } };
    } catch (err) {
      strapi.log.error('Chat log delete error:', err);
      return ctx.notFound('Chat log not found');
    }
  },
}));
