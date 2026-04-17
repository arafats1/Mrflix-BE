'use strict';

const { S3Client, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { getAccessibleSpace, getRequestedSpaceOwnerId, getSpacePrefixForUser } = require('../../../utils/mrkeyp-space');

function getStorage() {
  const PROVIDER = (process.env.STORAGE_PROVIDER || 'cloudflare').toLowerCase();
  if (PROVIDER === 'backblaze') {
    return {
      s3: new S3Client({
        region: 'us-east-005',
        endpoint: process.env.B2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.B2_ACCESS_KEY_ID,
          secretAccessKey: process.env.B2_ACCESS_SECRET,
        },
        forcePathStyle: true,
      }),
      bucket: process.env.B2_BUCKET || 'Mrflix',
      publicUrl: process.env.B2_PUBLIC_URL,
    };
  }
  return {
    s3: new S3Client({
      region: 'auto',
      endpoint: process.env.CF_ENDPOINT,
      credentials: {
        accessKeyId: process.env.CF_ACCESS_KEY_ID,
        secretAccessKey: process.env.CF_ACCESS_SECRET,
      },
      forcePathStyle: true,
    }),
    bucket: process.env.CF_BUCKET || 'mrflix',
    publicUrl: process.env.CF_PUBLIC_URL,
  };
}

function getFileType(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation') ||
    mimeType.includes('text/') ||
    mimeType.includes('msword') ||
    mimeType.includes('excel') ||
    mimeType.includes('powerpoint')
  ) return 'document';
  return 'other';
}

module.exports = {
  // List user's files with filtering and sorting
  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const {
      fileType,
      folderId,
      isFavorite,
      isTrash,
      sort = 'createdAt:desc',
      page = 1,
      pageSize = 50,
      search,
    } = ctx.query;

    const filters = { owner: { id: space.ownerId } };

    if (fileType) filters.fileType = fileType;
    if (folderId) filters.folder = { id: folderId };
    if (folderId === 'null') filters.folder = { id: { $null: true } };
    if (isFavorite === 'true') filters.isFavorite = true;
    if (isTrash === 'true') {
      filters.isTrash = true;
    } else {
      filters.isTrash = false;
    }
    if (search) {
      filters.$or = [
        { name: { $containsi: search } },
        { originalName: { $containsi: search } },
      ];
    }

    const entries = await strapi.entityService.findMany('api::storage-file.storage-file', {
      filters,
      populate: { folder: true },
      sort,
      limit: parseInt(pageSize),
      start: (parseInt(page) - 1) * parseInt(pageSize),
    });

    const total = await strapi.db.query('api::storage-file.storage-file').count({ where: filters });

    return { data: entries, meta: { total, page: parseInt(page), pageSize: parseInt(pageSize) } };
  },

  // Get single file
  async findOne(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const entry = await strapi.entityService.findOne('api::storage-file.storage-file', id, {
      populate: { folder: true, owner: true },
    });

    if (!entry) return ctx.notFound('File not found');
    if (entry.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    return { data: entry };
  },

  // Save file metadata after upload
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { name, originalName, key, publicUrl, mimeType, size, width, height, duration, folderId, takenAt, metadata } =
      ctx.request.body.data || ctx.request.body;

    if (!name || !key || !publicUrl || !mimeType || !size) {
      return ctx.badRequest('Missing required fields: name, key, publicUrl, mimeType, size');
    }

    // Check storage quota
    const storageUsed = await getUserStorageUsed(space.ownerId);
    const storageLimit = await getUserStorageLimit(space.ownerId);

    if (storageUsed + parseInt(size) > storageLimit) {
      return ctx.badRequest('Storage limit exceeded. Please upgrade your plan.');
    }

    const entry = await strapi.entityService.create('api::storage-file.storage-file', {
      data: {
        name,
        originalName: originalName || name,
        key,
        publicUrl,
        mimeType,
        fileType: getFileType(mimeType),
        size: String(size),
        width: width || null,
        height: height || null,
        duration: duration || null,
        owner: space.ownerId,
        folder: folderId || null,
        takenAt: takenAt || null,
        metadata: metadata || null,
      },
    });

    return { data: entry };
  },

  // Update file (rename, move to folder, favorite, etc.)
  async update(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::storage-file.storage-file', id, {
      populate: { owner: true },
    });

    if (!existing) return ctx.notFound('File not found');
    if (existing.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    const { name, folderId, isFavorite, isTrash } = ctx.request.body.data || ctx.request.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (folderId !== undefined) updateData.folder = folderId || null;
    if (isFavorite !== undefined) updateData.isFavorite = isFavorite;
    if (isTrash !== undefined) {
      updateData.isTrash = isTrash;
      updateData.trashedAt = isTrash ? new Date().toISOString() : null;
    }

    const entry = await strapi.entityService.update('api::storage-file.storage-file', id, {
      data: updateData,
    });

    return { data: entry };
  },

  // Permanently delete file (removes from Backblaze too)
  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::storage-file.storage-file', id, {
      populate: { owner: true },
    });

    if (!existing) return ctx.notFound('File not found');
    if (existing.owner?.id !== space.ownerId) return ctx.forbidden('Access denied');

    // Delete from cloud storage
    try {
      const { s3, bucket } = getStorage();
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: existing.key }));
      // Delete thumbnail if exists
      if (existing.thumbnailUrl && existing.key) {
        const thumbKey = `thumbnails/${existing.key}`;
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbKey }));
        } catch (e) { /* thumbnail may not exist */ }
      }
    } catch (err) {
      strapi.log.error('Failed to delete file from storage:', err);
    }

    await strapi.entityService.delete('api::storage-file.storage-file', id);

    return { data: { success: true } };
  },

  // Bulk delete files
  async bulkDelete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { fileIds } = ctx.request.body.data || ctx.request.body;
    if (!fileIds || !Array.isArray(fileIds)) {
      return ctx.badRequest('fileIds array is required');
    }

    const { s3, bucket } = getStorage();
    let deleted = 0;

    for (const fileId of fileIds) {
      const file = await strapi.entityService.findOne('api::storage-file.storage-file', fileId, {
        populate: { owner: true },
      });
      if (file && file.owner?.id === space.ownerId) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }));
        } catch (e) { /* continue */ }
        await strapi.entityService.delete('api::storage-file.storage-file', fileId);
        deleted++;
      }
    }

    return { data: { deleted } };
  },

  // Move to trash
  async trash(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { fileIds } = ctx.request.body.data || ctx.request.body;
    if (!fileIds || !Array.isArray(fileIds)) {
      return ctx.badRequest('fileIds array is required');
    }

    let trashed = 0;
    for (const fileId of fileIds) {
      const file = await strapi.entityService.findOne('api::storage-file.storage-file', fileId, {
        populate: { owner: true },
      });
      if (file && file.owner?.id === space.ownerId) {
        await strapi.entityService.update('api::storage-file.storage-file', fileId, {
          data: { isTrash: true, trashedAt: new Date().toISOString() },
        });
        trashed++;
      }
    }

    return { data: { trashed } };
  },

  // Restore from trash
  async restore(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { fileIds } = ctx.request.body.data || ctx.request.body;
    if (!fileIds || !Array.isArray(fileIds)) {
      return ctx.badRequest('fileIds array is required');
    }

    let restored = 0;
    for (const fileId of fileIds) {
      const file = await strapi.entityService.findOne('api::storage-file.storage-file', fileId, {
        populate: { owner: true },
      });
      if (file && file.owner?.id === space.ownerId) {
        await strapi.entityService.update('api::storage-file.storage-file', fileId, {
          data: { isTrash: false, trashedAt: null },
        });
        restored++;
      }
    }

    return { data: { restored } };
  },

  // Empty trash (permanently delete all trashed files)
  async emptyTrash(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const trashedFiles = await strapi.entityService.findMany('api::storage-file.storage-file', {
      filters: { owner: { id: space.ownerId }, isTrash: true },
      limit: -1,
    });

    const { s3, bucket } = getStorage();
    let deleted = 0;

    for (const file of trashedFiles) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }));
      } catch (e) { /* continue */ }
      await strapi.entityService.delete('api::storage-file.storage-file', file.id);
      deleted++;
    }

    return { data: { deleted } };
  },

  // Get storage usage stats
  async storageUsage(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const used = await getUserStorageUsed(space.ownerId);
    const limit = await getUserStorageLimit(space.ownerId);

    // Get counts by type
    const files = await strapi.entityService.findMany('api::storage-file.storage-file', {
      filters: { owner: { id: space.ownerId }, isTrash: false },
      limit: -1,
    });

    const stats = { image: { count: 0, size: 0 }, video: { count: 0, size: 0 }, document: { count: 0, size: 0 }, audio: { count: 0, size: 0 }, other: { count: 0, size: 0 } };
    for (const f of files) {
      const type = f.fileType || 'other';
      if (stats[type]) {
        stats[type].count++;
        stats[type].size += parseInt(f.size) || 0;
      }
    }

    return {
      data: {
        used,
        limit,
        percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
        stats,
        totalFiles: files.length,
      },
    };
  },

  // Get presigned URL for MrKeyp storage upload
  async getUploadUrl(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { fileName, contentType } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    // Check storage quota
    const storageUsed = await getUserStorageUsed(space.ownerId);
    const storageLimit = await getUserStorageLimit(space.ownerId);

    if (storageUsed >= storageLimit) {
      return ctx.badRequest('Storage limit exceeded. Please upgrade your plan.');
    }

    const { S3Client: S3, PutObjectCommand: PutCmd } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const ext = fileName.split('.').pop();
    const key = `${getSpacePrefixForUser(space.owner)}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const { s3, bucket, publicUrl } = getStorage();
    const command = new (require('@aws-sdk/client-s3').PutObjectCommand)({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 7200 });

    ctx.body = {
      uploadUrl: presignedUrl,
      key,
      publicUrl: `${publicUrl}/${key}`,
    };
  },

  // Initiate multipart upload for large files
  async initiateUpload(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { fileName, contentType } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    const { CreateMultipartUploadCommand } = require('@aws-sdk/client-s3');

    const ext = fileName.split('.').pop();
    const key = `${getSpacePrefixForUser(space.owner)}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const { s3, bucket, publicUrl } = getStorage();
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }));

    ctx.body = { uploadId: UploadId, key, publicUrl: `${publicUrl}/${key}` };
  },

  // Get part presigned URL
  async getPartUrl(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { key, uploadId, partNumber } = ctx.request.body;
    if (!key || !uploadId || !partNumber) {
      return ctx.badRequest('key, uploadId, and partNumber are required');
    }

    // Verify the key belongs to this user
    if (!key.startsWith(`${getSpacePrefixForUser(space.owner)}/`)) {
      return ctx.forbidden('Access denied');
    }

    const { UploadPartCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const { s3, bucket } = getStorage();
    const presignedUrl = await getSignedUrl(s3, new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }), { expiresIn: 3600 });

    ctx.body = { presignedUrl };
  },

  // Complete multipart upload
  async completeUpload(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const space = await getAccessibleSpace(strapi, ctx.state.user, getRequestedSpaceOwnerId(ctx));
    if (!space) return ctx.forbidden('Access denied');

    const { key, uploadId, parts } = ctx.request.body;
    if (!key || !uploadId || !parts) {
      return ctx.badRequest('key, uploadId, and parts are required');
    }

    if (!key.startsWith(`${getSpacePrefixForUser(space.owner)}/`)) {
      return ctx.forbidden('Access denied');
    }

    const { CompleteMultipartUploadCommand } = require('@aws-sdk/client-s3');

    const { s3, bucket, publicUrl } = getStorage();
    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
      },
    }));

    ctx.body = { publicUrl: `${publicUrl}/${key}`, key };
  },
};

// Helper: get user's total storage used (bytes)
async function getUserStorageUsed(userId) {
  const files = await strapi.entityService.findMany('api::storage-file.storage-file', {
    filters: { owner: { id: userId }, isTrash: false },
    limit: -1,
  });
  return files.reduce((sum, f) => sum + (parseInt(f.size) || 0), 0);
}

// Helper: get user's storage limit (bytes)
async function getUserStorageLimit(userId) {
  // Check for active storage subscription
  const now = new Date().toISOString();
  const subs = await strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
    filters: {
      subscriber: { id: userId },
      status: 'active',
      endDate: { $gte: now },
    },
    sort: 'endDate:desc',
    limit: 1,
  });

  if (subs && subs.length > 0) {
    if (subs[0].isUnlimited) return Number.MAX_SAFE_INTEGER;
    return subs[0].storageGB * 1024 * 1024 * 1024;
  }

  // Free tier - get from site settings
  const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
  const freeGB = settings?.storageFreeTierGB || 1;
  return freeGB * 1024 * 1024 * 1024;
}
