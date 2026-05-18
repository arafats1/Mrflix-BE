'use strict';

const path = require('path');
const { Readable } = require('stream');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const PROVIDER = (process.env.STORAGE_PROVIDER || 'backblaze').toLowerCase();

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

function getCloudflareS3Client() {
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

function getStorage() {
  if (PROVIDER === 'backblaze') {
    return {
      s3: getBackblazeS3Client(),
      bucket: process.env.B2_BUCKET || 'Mrflix',
      publicUrl: process.env.B2_PUBLIC_URL,
      provider: 'backblaze',
    };
  }

  return {
    s3: getCloudflareS3Client(),
    bucket: process.env.CF_BUCKET || 'mrflix',
    publicUrl: process.env.CF_PUBLIC_URL,
    provider: 'cloudflare',
  };
}

function normalizePublicUrl(baseUrl, key) {
  if (!baseUrl) return key;
  return `${String(baseUrl).replace(/\/+$/, '')}/${String(key).replace(/^\/+/, '')}`;
}

function sanitizeKeySegment(value, fallback = 'file') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function inferExtension({ sourceUrl, contentType, fallback = '.mp4' } = {}) {
  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType.includes('webm')) return '.webm';
  if (normalizedType.includes('quicktime')) return '.mov';
  if (normalizedType.includes('ogg')) return '.ogg';
  if (normalizedType.includes('mpeg')) return '.mpg';
  if (normalizedType.includes('mp4')) return '.mp4';

  try {
    const ext = path.extname(new URL(String(sourceUrl || '')).pathname || '');
    if (ext) return ext.toLowerCase();
  } catch {
    // Ignore parse failures and fall back below.
  }

  return fallback;
}

async function uploadStreamToStorage({ key, body, contentType, cacheControl }) {
  const { s3, bucket, publicUrl } = getStorage();
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: cacheControl,
  }));

  return {
    key,
    url: normalizePublicUrl(publicUrl, key),
  };
}

function toNodeReadableStream(webStream) {
  if (!webStream) return null;
  return Readable.fromWeb(webStream);
}

module.exports = {
  getStorage,
  inferExtension,
  sanitizeKeySegment,
  uploadStreamToStorage,
  toNodeReadableStream,
};