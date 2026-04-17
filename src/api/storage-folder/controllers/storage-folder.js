'use strict';

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getAccessibleSpace, getRequestedSpaceOwnerId } = require('../../../utils/mrkeyp-space');

function getStorage() {
  const PROVIDER = (process.env.STORAGE_PROVIDER || 'cloudflare').toLowerCase();
  if (PROVIDER === 'backblaze') {
    return {
      s3: new S3Client({
        region: 'us-east-005',
        endpoint: process.env.B2_ENDPOINT,
        credentials: { accessKeyId: process.env.B2_ACCESS_KEY_ID, secretAccessKey: process.env.B2_ACCESS_SECRET },
        forcePathStyle: true,
      }),
      bucket: process.env.B2_BUCKET || 'Mrflix',
    };
  }
  return {
    s3: new S3Client({
      region: 'auto',
      endpoint: process.env.CF_ENDPOINT,
      credentials: { accessKeyId: process.env.CF_ACCESS_KEY_ID, secretAccessKey: process.env.CF_ACCESS_SECRET },
      forcePathStyle: true,
    }),
    bucket: process.env.CF_BUCKET || 'mrflix',
  };
}

module.exports = {
  // List user's folders
  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { parentId, isTrash, search } = ctx.query;
    const filters = { owner: { id: space.ownerId } };

    if (parentId) filters.parent = { id: parentId };
    if (parentId === 'null' || !parentId) filters.parent = { id: { $null: true } };
    if (isTrash === 'true') {
      filters.isTrash = true;
    } else {
      filters.isTrash = false;
    }
    if (search) filters.name = { $containsi: search };

    const entries = await strapi.entityService.findMany('api::storage-folder.storage-folder', {
      filters,
      populate: { children: true },
      sort: 'name:asc',
    });

    const folderIds = entries.map((entry) => entry.id);
    let fileCounts = {};

    if (folderIds.length > 0) {
      const folderFiles = await strapi.entityService.findMany('api::storage-file.storage-file', {
        filters: {
          owner: { id: space.ownerId },
          isTrash: false,
          folder: { id: { $in: folderIds } },
        },
        populate: { folder: true },
        limit: -1,
      });

      fileCounts = folderFiles.reduce((acc, file) => {
        const folderId = file.folder?.id;
        if (folderId) acc[folderId] = (acc[folderId] || 0) + 1;
        return acc;
      }, {});
    }

    return {
      data: entries.map((entry) => ({
        ...entry,
        fileCount: fileCounts[entry.id] || 0,
      })),
    };
  },

  // Get single folder with contents
  async findOne(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const entry = await strapi.entityService.findOne('api::storage-folder.storage-folder', id, {
      populate: {
        owner: true,
        parent: true,
        children: true,
        files: {
          populate: { folder: true },
          sort: 'createdAt:desc',
        },
      },
    });

    if (!entry) return ctx.notFound('Folder not found');
    if (entry.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    // Build breadcrumb path
    const breadcrumbs = [];
    let current = entry;
    while (current.parent) {
      const parent = await strapi.entityService.findOne('api::storage-folder.storage-folder', current.parent.id, {
        populate: { parent: true },
      });
      if (parent) {
        breadcrumbs.unshift({ id: parent.id, name: parent.name });
        current = parent;
      } else break;
    }

    return { data: { ...entry, breadcrumbs } };
  },

  // Create folder
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { name, parentId, color, icon, description } = ctx.request.body.data || ctx.request.body;

    if (!name) return ctx.badRequest('Folder name is required');

    // Check for duplicate name in same parent
    const existing = await strapi.entityService.findMany('api::storage-folder.storage-folder', {
      filters: {
        owner: { id: space.ownerId },
        name,
        parent: parentId ? { id: parentId } : { id: { $null: true } },
        isTrash: false,
      },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('A folder with this name already exists here');
    }

    const entry = await strapi.entityService.create('api::storage-folder.storage-folder', {
      data: {
        name,
        description: description || null,
        owner: space.ownerId,
        parent: parentId || null,
        color: color || '#6366f1',
        icon: icon || 'folder',
      },
    });

    return { data: entry };
  },

  // Update folder
  async update(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::storage-folder.storage-folder', id, {
      populate: { owner: true },
    });

    if (!existing) return ctx.notFound('Folder not found');
    if (existing.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    const { name, parentId, color, icon, description, isTrash } = ctx.request.body.data || ctx.request.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (parentId !== undefined) updateData.parent = parentId || null;
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;
    if (description !== undefined) updateData.description = description;
    if (isTrash !== undefined) {
      updateData.isTrash = isTrash;
      updateData.trashedAt = isTrash ? new Date().toISOString() : null;
    }

    const entry = await strapi.entityService.update('api::storage-folder.storage-folder', id, {
      data: updateData,
    });

    return { data: entry };
  },

  // Delete folder and all contents permanently
  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const folder = await strapi.entityService.findOne('api::storage-folder.storage-folder', id, {
      populate: { owner: true, files: true, children: true },
    });

    if (!folder) return ctx.notFound('Folder not found');
    if (folder.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    // Recursively delete all files and subfolders
    await deleteFolderRecursive(id, ctx.state.user.id);

    return { data: { success: true } };
  },
};

async function deleteFolderRecursive(folderId, userId) {
  const folder = await strapi.entityService.findOne('api::storage-folder.storage-folder', folderId, {
    populate: { files: true, children: true },
  });

  if (!folder) return;

  // Delete all files in this folder
  const { s3, bucket } = getStorage();
  if (folder.files) {
    for (const file of folder.files) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }));
      } catch (e) { /* continue */ }
      await strapi.entityService.delete('api::storage-file.storage-file', file.id);
    }
  }

  // Recursively delete children
  if (folder.children) {
    for (const child of folder.children) {
      await deleteFolderRecursive(child.id, userId);
    }
  }

  // Delete shared links for this folder
  const links = await strapi.entityService.findMany('api::shared-link.shared-link', {
    filters: { folder: { id: folderId } },
    limit: -1,
  });
  for (const link of links) {
    await strapi.entityService.delete('api::shared-link.shared-link', link.id);
  }

  // Delete the folder itself
  await strapi.entityService.delete('api::storage-folder.storage-folder', folderId);
}
