'use strict';

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function getAwsConfig() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'eu-north-1';

  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
  };
}

function isConfigured() {
  return !!getAwsConfig();
}

function getS3Client() {
  const config = getAwsConfig();
  if (!config) return null;

  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function buildS3Destination() {
  const config = getAwsConfig();
  if (!config) return null;

  return {
    provider: 's3',
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey,
  };
}

async function getPresignedObjectUrl(key, expiresIn = 7 * 24 * 60 * 60) {
  const config = getAwsConfig();
  const client = getS3Client();
  if (!config || !client || !key) return null;

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
    { expiresIn },
  );
}

async function listObjects({ prefix = '', afterDate } = {}) {
  const config = getAwsConfig();
  const client = getS3Client();
  if (!config || !client) return [];

  const afterTime = afterDate ? Date.parse(afterDate) : null;
  const results = [];
  let continuationToken;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents || []) {
      if (!item?.Key) continue;
      if (Number.isFinite(afterTime) && item.LastModified && item.LastModified.getTime() < afterTime) {
        continue;
      }
      results.push({
        key: item.Key,
        lastModified: item.LastModified,
        size: item.Size,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return results.sort((left, right) => {
    const leftTime = left.lastModified?.getTime?.() || 0;
    const rightTime = right.lastModified?.getTime?.() || 0;
    return rightTime - leftTime;
  });
}

function pickLatestByExtension(objects, extensions) {
  const normalized = extensions.map((ext) => ext.toLowerCase());
  return objects.find((item) => normalized.some((ext) => item.key.toLowerCase().endsWith(ext))) || null;
}

async function resolveLatestMedia({ afterDate } = {}) {
  const objects = await listObjects({ afterDate });
  const recording = pickLatestByExtension(objects, ['.mp4', '.mkv', '.webm']);
  const transcript = pickLatestByExtension(objects, ['.md', '.txt', '.json']);

  return {
    recordingKey: recording?.key || null,
    recordingLastModified: recording?.lastModified || null,
    transcriptKey: transcript?.key || null,
    transcriptLastModified: transcript?.lastModified || null,
  };
}

async function getObjectStream(key) {
  const config = getAwsConfig();
  const client = getS3Client();
  if (!config || !client || !key) return null;

  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }));

  if (!response?.Body) return null;

  return {
    body: response.Body,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength,
  };
}

module.exports = {
  buildS3Destination,
  getAwsConfig,
  getObjectStream,
  getPresignedObjectUrl,
  isConfigured,
  listObjects,
  resolveLatestMedia,
};
