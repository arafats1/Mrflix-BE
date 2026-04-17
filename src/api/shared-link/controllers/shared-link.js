'use strict';

const crypto = require('crypto');

module.exports = {
  // Create shared link for a folder or file
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const { folderId, fileId, permission, expiresAt, password } = ctx.request.body.data || ctx.request.body;

    if (!folderId && !fileId) return ctx.badRequest('Either folderId or fileId is required');

    // Verify ownership
    if (folderId) {
      const folder = await strapi.entityService.findOne('api::storage-folder.storage-folder', folderId, {
        populate: { owner: true },
      });
      if (!folder) return ctx.notFound('Folder not found');
      if (folder.owner?.id !== ctx.state.user.id) return ctx.forbidden('Access denied');
    }

    if (fileId) {
      const file = await strapi.entityService.findOne('api::storage-file.storage-file', fileId, {
        populate: { owner: true },
      });
      if (!file) return ctx.notFound('File not found');
      if (file.owner?.id !== ctx.state.user.id) return ctx.forbidden('Access denied');
    }

    const token = crypto.randomBytes(32).toString('hex');

    const entry = await strapi.entityService.create('api::shared-link.shared-link', {
      data: {
        token,
        owner: ctx.state.user.id,
        folder: folderId || null,
        file: fileId || null,
        permission: permission || 'view',
        expiresAt: expiresAt || null,
        password: password || null,
        isActive: true,
      },
    });

    const baseUrl = process.env.MRKEYP_URL || 'http://localhost:3001';

    return {
      data: {
        ...entry,
        shareUrl: `${baseUrl}/shared/${token}`,
      },
    };
  },

  // Access shared link (public)
  async access(ctx) {
    const { token } = ctx.params;
    const { password } = ctx.query;

    const entries = await strapi.entityService.findMany('api::shared-link.shared-link', {
      filters: { token, isActive: true },
      populate: {
        folder: { populate: { files: true, children: true } },
        file: true,
        owner: { fields: ['id', 'username'] },
      },
      limit: 1,
    });

    if (!entries || entries.length === 0) return ctx.notFound('Link not found or expired');

    const link = entries[0];

    // Check expiry
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return ctx.notFound('This link has expired');
    }

    // Check password
    if (link.password && link.password !== password) {
      return ctx.unauthorized('Password required');
    }

    // Increment access count
    await strapi.entityService.update('api::shared-link.shared-link', link.id, {
      data: { accessCount: (link.accessCount || 0) + 1 },
    });

    return {
      data: {
        type: link.folder ? 'folder' : 'file',
        permission: link.permission,
        folder: link.folder || null,
        file: link.file || null,
        sharedBy: link.owner?.username || 'Unknown',
      },
    };
  },

  // List user's shared links
  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const entries = await strapi.entityService.findMany('api::shared-link.shared-link', {
      filters: { owner: { id: ctx.state.user.id } },
      populate: { folder: true, file: true },
      sort: 'createdAt:desc',
    });

    const baseUrl = process.env.MRKEYP_URL || 'http://localhost:3001';

    return {
      data: entries.map((e) => ({
        ...e,
        shareUrl: `${baseUrl}/shared/${e.token}`,
      })),
    };
  },

  // Delete/revoke shared link
  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::shared-link.shared-link', id, {
      populate: { owner: true },
    });

    if (!existing) return ctx.notFound('Link not found');
    if (existing.owner?.id !== ctx.state.user.id) return ctx.forbidden('Access denied');

    await strapi.entityService.delete('api::shared-link.shared-link', id);

    return { data: { success: true } };
  },
};
