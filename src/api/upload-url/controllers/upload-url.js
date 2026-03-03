'use strict';

const { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// ──────────────────────────────────────────
// Storage provider: "backblaze" or "cloudflare"
// Controlled by STORAGE_PROVIDER env var
// ──────────────────────────────────────────
const PROVIDER = (process.env.STORAGE_PROVIDER || 'cloudflare').toLowerCase();

// ── Cloudflare R2 config ──
// function getCloudflarS3Client() {
//   return new S3Client({
//     region: 'auto',
//     endpoint: process.env.CF_ENDPOINT,
//     credentials: {
//       accessKeyId: process.env.CF_ACCESS_KEY_ID,
//       secretAccessKey: process.env.CF_ACCESS_SECRET,
//     },
//     forcePathStyle: true,
//   });
// }
// const CF_BUCKET = process.env.CF_BUCKET || 'mrflix';
// const CF_PUBLIC_URL = process.env.CF_PUBLIC_URL;

// ── Backblaze B2 config ──
function getBackblazeS3Client() {
  return new S3Client({
    region: 'us-east-005',
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID,
      secretAccessKey: process.env.B2_ACCESS_SECRET,
    },
    forcePathStyle: true,
  });
}

/**
 * Returns the active S3 client, bucket name, and public URL
 * based on the STORAGE_PROVIDER env var.
 * Switch providers by changing STORAGE_PROVIDER in .env
 */
function getStorage() {
  if (PROVIDER === 'backblaze') {
    return {
      s3: getBackblazeS3Client(),
      bucket: process.env.B2_BUCKET || 'Mrflix',
      publicUrl: process.env.B2_PUBLIC_URL,
      provider: 'backblaze',
    };
  }

  // Default: Cloudflare R2
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
    provider: 'cloudflare',
  };
}

module.exports = {
  /**
   * Simple presigned URL for small files (< 100MB)
   */
  async getPresignedUrl(ctx) {
    // Check if user is admin
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });

    if (userWithRole?.role?.type !== 'admin' && userWithRole?.role?.name !== 'Admin') {
      return ctx.forbidden('Admin access required');
    }

    const { fileName, contentType, folder } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    const ext = fileName.split('.').pop();
    const prefix = folder || 'videos';
    const key = `${prefix}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const { s3, bucket, publicUrl, provider } = getStorage();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    ctx.body = {
      uploadUrl: presignedUrl,
      key,
      publicUrl: `${publicUrl}/${key}`,
      provider,
    };
  },

  /**
   * Initiate multipart upload for large files (> 100MB)
   */
  async initiateMultipartUpload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });

    if (userWithRole?.role?.type !== 'admin' && userWithRole?.role?.name !== 'Admin') {
      return ctx.forbidden('Admin access required');
    }

    const { fileName, contentType, folder } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    const ext = fileName.split('.').pop();
    const prefix = folder || 'videos';
    const key = `${prefix}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const { s3, bucket, publicUrl, provider } = getStorage();
    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const { UploadId } = await s3.send(command);

    ctx.body = {
      uploadId: UploadId,
      key,
      publicUrl: `${publicUrl}/${key}`,
      provider,
    };
  },

  /**
   * Get presigned URL for a single part of multipart upload
   */
  async getPartPresignedUrl(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { key, uploadId, partNumber } = ctx.request.body;
    if (!key || !uploadId || !partNumber) {
      return ctx.badRequest('key, uploadId, and partNumber are required');
    }

    const { s3, bucket } = getStorage();
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    ctx.body = { presignedUrl };
  },

  /**
   * Complete multipart upload after all parts uploaded
   */
  async completeMultipartUpload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { key, uploadId, parts } = ctx.request.body;
    if (!key || !uploadId || !parts) {
      return ctx.badRequest('key, uploadId, and parts are required');
    }

    const { s3, bucket, publicUrl } = getStorage();
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    });

    await s3.send(command);

    ctx.body = {
      publicUrl: `${publicUrl}/${key}`,
      key,
    };
  },

  /**
   * Abort a multipart upload (cleanup on failure)
   */
  async abortMultipartUpload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { key, uploadId } = ctx.request.body;
    if (!key || !uploadId) {
      return ctx.badRequest('key and uploadId are required');
    }

    const { s3, bucket } = getStorage();
    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });

    await s3.send(command);

    ctx.body = { success: true };
  },
};
