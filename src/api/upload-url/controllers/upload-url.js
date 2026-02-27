'use strict';

const { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.CF_ENDPOINT,
    credentials: {
      accessKeyId: process.env.CF_ACCESS_KEY_ID,
      secretAccessKey: process.env.CF_ACCESS_SECRET,
    },
    forcePathStyle: true,
  });
}

const BUCKET = process.env.CF_BUCKET || 'mrflix';
const PUBLIC_URL = process.env.CF_PUBLIC_URL;

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

    const { fileName, contentType } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    const ext = fileName.split('.').pop();
    const key = `videos/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const s3 = getS3Client();
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    ctx.body = {
      uploadUrl: presignedUrl,
      key,
      publicUrl: `${PUBLIC_URL}/${key}`,
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

    const { fileName, contentType } = ctx.request.body;
    if (!fileName || !contentType) {
      return ctx.badRequest('fileName and contentType are required');
    }

    const ext = fileName.split('.').pop();
    const key = `videos/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const s3 = getS3Client();
    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const { UploadId } = await s3.send(command);

    ctx.body = {
      uploadId: UploadId,
      key,
      publicUrl: `${PUBLIC_URL}/${key}`,
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

    const s3 = getS3Client();
    const command = new UploadPartCommand({
      Bucket: BUCKET,
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

    const s3 = getS3Client();
    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
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
      publicUrl: `${PUBLIC_URL}/${key}`,
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

    const s3 = getS3Client();
    const command = new AbortMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
    });

    await s3.send(command);

    ctx.body = { success: true };
  },
};
