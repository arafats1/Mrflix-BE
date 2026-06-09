'use strict';

/**
 * Whereby Embedded helper.
 *
 * Docs: https://docs.whereby.com/whereby-101/create-a-meeting-with-the-api
 *
 * Env vars required:
 *   WHEREBY_API_KEY     – API key from https://whereby.dev/org
 *   WHEREBY_BASE_URL    – defaults to https://api.whereby.dev/v1
 *   AWS_ACCESS_KEY_ID   – for self-hosted recording/transcription storage
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_BUCKET_NAME
 *   AWS_REGION
 *
 * If WHEREBY_API_KEY is not set, this falls back to deterministic mock URLs
 * so the rest of the system keeps working in local/dev.
 */

const { buildS3Destination } = require('./whereby-s3');

const DEFAULT_BASE_URL = 'https://api.whereby.dev/v1';
const LEGACY_BASE_URL = 'https://api.appear.in/v1';

function isEnabled() {
  return !!process.env.WHEREBY_API_KEY;
}

function getBaseUrls() {
  return [...new Set([
    process.env.WHEREBY_BASE_URL,
    DEFAULT_BASE_URL,
    LEGACY_BASE_URL,
  ].filter(Boolean))];
}

function getAuthHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`,
    ...extra,
  };
}

async function requestWhereby(path, options) {
  const errors = [];
  let lastStatusError = null;

  for (const baseUrl of getBaseUrls()) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, options);
    } catch (error) {
      errors.push(`${baseUrl}: ${error.message}`);
      continue;
    }

    if (res.ok) {
      return res;
    }

    const text = await res.text();
    errors.push(`${baseUrl}: ${res.status} ${text}`);
    lastStatusError = new Error(`Whereby request failed: ${baseUrl}: ${res.status} ${text}`);
  }

  if (lastStatusError) {
    throw new Error(`Whereby request failed across configured endpoints. ${errors.join(' | ')}`);
  }

  throw new Error(`Whereby request failed across configured endpoints. ${errors.join(' | ')}`);
}

function buildMeetingMediaOptions() {
  const destination = buildS3Destination();
  if (!destination) return {};

  return {
    recording: {
      type: 'cloud',
      startTrigger: 'none',
      destination: {
        ...destination,
        fileFormat: 'mp4',
      },
    },
    liveTranscription: {
      language: process.env.WHEREBY_TRANSCRIPTION_LANGUAGE || 'en',
      startTrigger: 'manual',
      destination,
    },
  };
}

async function createMeeting({ startsAt, endsAt, isLocked = false, roomMode = 'group' }) {
  if (!isEnabled()) {
    const id = `mock_${Math.random().toString(36).slice(2, 10)}`;
    const base = `https://movo-entrepreneur.whereby.com/${id}`;
    return {
      meetingId: id,
      roomName: id,
      hostRoomUrl: `${base}?host=true`,
      viewerRoomUrl: base,
      startsAt: startsAt || new Date().toISOString(),
      endsAt: endsAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      mock: true,
    };
  }

  const media = buildMeetingMediaOptions();
  const body = {
    isLocked,
    roomMode,
    startDate: startsAt,
    endDate: endsAt,
    fields: ['hostRoomUrl'],
    ...media,
  };

  const res = await requestWhereby('/meetings', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return {
    meetingId: data.meetingId,
    roomName: data.roomName,
    hostRoomUrl: data.hostRoomUrl,
    viewerRoomUrl: data.roomUrl,
    startsAt: data.startDate,
    endsAt: data.endDate,
  };
}

async function deleteMeeting(meetingId) {
  if (!isEnabled() || !meetingId || meetingId.startsWith('mock_')) return true;
  await requestWhereby(`/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return true;
}

async function listRecordings({ cursor, limit = 50 } = {}) {
  if (!isEnabled()) return { results: [], cursor: null };

  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));

  const query = params.toString();
  const res = await requestWhereby(`/recordings${query ? `?${query}` : ''}`, {
    headers: getAuthHeaders(),
  });

  return res.json();
}

async function getRecordingAccessLink(recordingId) {
  if (!isEnabled() || !recordingId) return null;

  const res = await requestWhereby(`/recordings/${recordingId}/access-link`, {
    headers: getAuthHeaders(),
  });

  return res.json();
}

async function listTranscriptions({ cursor, limit = 50 } = {}) {
  if (!isEnabled()) return { results: [], cursor: null };

  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));

  const query = params.toString();
  const res = await requestWhereby(`/transcriptions${query ? `?${query}` : ''}`, {
    headers: getAuthHeaders(),
  });

  return res.json();
}

async function createTranscription(recordingId) {
  if (!isEnabled() || !recordingId) return null;

  const res = await requestWhereby('/transcriptions', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ recordingId }),
  });

  return res.json();
}

async function getTranscriptionAccessLink(transcriptionId) {
  if (!isEnabled() || !transcriptionId) return null;

  const res = await requestWhereby(`/transcriptions/${transcriptionId}/access-link`, {
    headers: getAuthHeaders(),
  });

  return res.json();
}

module.exports = {
  buildMeetingMediaOptions,
  createMeeting,
  createTranscription,
  deleteMeeting,
  getRecordingAccessLink,
  getTranscriptionAccessLink,
  isEnabled,
  listRecordings,
  listTranscriptions,
};
