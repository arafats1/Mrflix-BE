'use strict';

/**
 * Whereby Embedded helper.
 *
 * Docs: https://docs.whereby.com/whereby-101/create-a-meeting-with-the-api
 *
 * Env vars required:
 *   WHEREBY_API_KEY     – API key from https://whereby.dev/org
 *   WHEREBY_BASE_URL    – defaults to https://api.whereby.dev/v1
 *
 * If WHEREBY_API_KEY is not set, this falls back to deterministic mock URLs
 * so the rest of the system keeps working in local/dev.
 */

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

async function createMeeting({ startsAt, endsAt, isLocked = false, roomMode = 'group' }) {
  if (!isEnabled()) {
    // Dev fallback so frontend can keep functioning without API key.
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

  const res = await requestWhereby('/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      isLocked,
      roomMode,
      startDate: startsAt,
      endDate: endsAt,
      fields: ['hostRoomUrl'],
    }),
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
    headers: { Authorization: `Bearer ${process.env.WHEREBY_API_KEY}` },
  });
  return true;
}

module.exports = { createMeeting, deleteMeeting, isEnabled };
