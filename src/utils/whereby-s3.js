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

function parseMediaTimestamp(key) {
  const match = String(key || '').match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\.(mp4|mkv|webm|md|txt|json)$/i);
  if (!match) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSessionActivityTime(session) {
  const joinTimes = (Array.isArray(session?.attendees) ? session.attendees : [])
    .map((entry) => Date.parse(entry?.joinedAt || ''))
    .filter(Number.isFinite);

  if (joinTimes.length) return Math.min(...joinTimes);

  const startsAt = Date.parse(session?.startsAt || '');
  return Number.isFinite(startsAt) ? startsAt : null;
}

function isWherebyRecordingKey(key) {
  return /^[0-9a-f-]{36}-\d{4}-\d{2}-\d{2}T/i.test(String(key || ''));
}

function findClosestMediaObject(objects, activityTime, extensions, { maxDeltaMs = 15 * 60 * 1000, usedKeys = new Set() } = {}) {
  if (!Number.isFinite(activityTime)) return null;

  const normalizedExtensions = extensions.map((ext) => ext.toLowerCase());
  let bestMatch = null;

  for (const item of objects) {
    if (!item?.key || usedKeys.has(item.key)) continue;
    if (!normalizedExtensions.some((ext) => item.key.toLowerCase().endsWith(ext))) continue;

    const mediaTime = parseMediaTimestamp(item.key) || item.lastModified?.getTime?.() || null;
    if (!Number.isFinite(mediaTime)) continue;

    const delta = Math.abs(mediaTime - activityTime);
    if (delta > maxDeltaMs) continue;

    if (!bestMatch || delta < bestMatch.delta) {
      bestMatch = { ...item, delta, mediaTime };
    }
  }

  return bestMatch;
}

async function findRecordingForSession(session, { usedKeys = new Set() } = {}) {
  const activityTime = getSessionActivityTime(session);
  if (!Number.isFinite(activityTime)) return null;

  const searchStart = new Date(activityTime - 24 * 60 * 60 * 1000).toISOString();
  const objects = await listObjects({ afterDate: searchStart });
  const candidates = objects.filter((item) => isWherebyRecordingKey(item.key));

  return findClosestMediaObject(candidates, activityTime, ['.mp4', '.mkv', '.webm'], { usedKeys });
}

async function findTranscriptForSession(session, { usedKeys = new Set(), nearTime } = {}) {
  const activityTime = nearTime || getSessionActivityTime(session);
  if (!Number.isFinite(activityTime)) return null;

  const searchStart = new Date(activityTime - 24 * 60 * 60 * 1000).toISOString();
  const objects = await listObjects({ afterDate: searchStart });

  return findClosestMediaObject(objects, activityTime, ['.md', '.txt', '.json'], {
    usedKeys,
    maxDeltaMs: 6 * 60 * 60 * 1000,
  });
}

async function resolveLatestMedia({ afterDate } = {}) {
  const objects = await listObjects({ afterDate });
  const recording = pickLatestByExtension(objects.filter((item) => isWherebyRecordingKey(item.key)), ['.mp4', '.mkv', '.webm']);
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
  findRecordingForSession,
  findTranscriptForSession,
  getAwsConfig,
  getObjectStream,
  getPresignedObjectUrl,
  getSessionActivityTime,
  isConfigured,
  listObjects,
  resolveLatestMedia,
};
