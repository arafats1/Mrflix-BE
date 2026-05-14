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

function isEnabled() {
  return !!process.env.WHEREBY_API_KEY;
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

  const baseUrl = process.env.WHEREBY_BASE_URL || DEFAULT_BASE_URL;
  const res = await fetch(`${baseUrl}/meetings`, {
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

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Whereby create meeting failed: ${res.status} ${txt}`);
  }

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
  const baseUrl = process.env.WHEREBY_BASE_URL || DEFAULT_BASE_URL;
  await fetch(`${baseUrl}/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.WHEREBY_API_KEY}` },
  });
  return true;
}

module.exports = { createMeeting, deleteMeeting, isEnabled };
