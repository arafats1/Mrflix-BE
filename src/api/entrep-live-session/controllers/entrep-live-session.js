'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');
const whereby = require('../../../utils/whereby');
const wherebyS3 = require('../../../utils/whereby-s3');
const { listCourseLearnerIds, notifyUsers } = require('../../../utils/entrep-notifications');
const { inferExtension, sanitizeKeySegment, toNodeReadableStream, uploadStreamToStorage } = require('../../../utils/storage');

function normalizeAlumniAudience(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['learner', 'trainer', 'cluster'].includes(normalized) ? normalized : fallback;
}

function hasAlumniAccess(profile, alumniAudience) {
  if (!profile) return false;
  if (profile?.isAlumni) return !alumniAudience || profile.alumniMemberType === alumniAudience;
  // allow current learners to view learner alumni sessions
  if (profile?.role === 'learner') return !alumniAudience || alumniAudience === 'learner';
  return false;
}

async function listAlumniRecipientIds(strapi, alumniAudience, excludeUserId) {
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: {
      isAlumni: true,
      alumniMemberType: alumniAudience,
      user: {
        id: { $ne: Number(excludeUserId) || 0 },
      },
    },
    populate: ['user'],
    limit: 500,
  });

  return profiles.map((entry) => Number(entry?.user?.id || entry?.user)).filter(Boolean);
}

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }

  const authHeader = ctx.request.header?.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;
  const queryToken = typeof ctx.query?.access_token === 'string' ? ctx.query.access_token : null;
  const token = bearerToken || queryToken;

  if (token) {
    try {
      const verified = await strapi.plugins['users-permissions'].services.jwt.verify(token);
      if (verified?.id) {
        return strapi.entityService.findOne('plugin::users-permissions.user', verified.id, { populate: ['role'] });
      }
    } catch (_) {
      return null;
    }
  }

  return null;
}

async function getTrainerProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId }, limit: 1, populate: ['cluster'],
  });
  return list?.[0] || null;
}

async function listManagedCourseIds(strapi, profile) {
  if (!profile?.id || !['trainer', 'provider', 'admin'].includes(profile.role)) return [];
  const courses = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
    filters: { trainer: profile.id },
    limit: 500,
  });
  return courses.map((course) => Number(course?.id)).filter(Boolean);
}

async function listEnrolledCourseIds(strapi, userId) {
  if (!userId) return [];
  const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: {
      user: userId,
      status: { $in: ['active', 'completed'] },
    },
    populate: ['course'],
    limit: 500,
  });

  return enrollments.map((enrollment) => Number(enrollment?.course?.id)).filter(Boolean);
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
}

async function buildSessionAccessContext(strapi, user) {
  const profile = user ? await getTrainerProfile(strapi, user.id) : null;
  return {
    user,
    profile,
    isAdmin: isAdminUser(user, profile),
    enrolledCourseIds: user ? await listEnrolledCourseIds(strapi, user.id) : [],
    managedCourseIds: profile ? await listManagedCourseIds(strapi, profile) : [],
  };
}

function hasSessionAccess(session, access) {
  if (access?.isAdmin) return true;

  const courseId = Number(session?.course?.id || session?.course || 0);
  const clusterId = Number(session?.cluster?.id || session?.cluster || 0);
  const trainerUserId = Number(session?.trainer?.user?.id || 0);
  const sessionAudience = String(session?.audience || '').toLowerCase();
  const alumniAudience = normalizeAlumniAudience(session?.alumniAudience, null);

  if (!access?.user) {
    return sessionAudience !== 'alumni' && !courseId && !clusterId;
  }

  if (trainerUserId && trainerUserId === Number(access.user.id)) return true;
  if (sessionAudience === 'alumni') return hasAlumniAccess(access.profile, alumniAudience);
  if (courseId && (access.enrolledCourseIds.includes(courseId) || access.managedCourseIds.includes(courseId))) return true;
  if (clusterId && Number(access.profile?.cluster?.id || 0) === clusterId) return true;
  if (!courseId && !clusterId) return true;

  return false;
}

function sanitizeSessionForUser(session, access) {
  const canSeeHostRoom = access?.isAdmin || Number(session?.trainer?.user?.id || 0) === Number(access?.user?.id || 0);
  return {
    ...session,
    hostRoomUrl: canSeeHostRoom ? session.hostRoomUrl : undefined,
    recordingS3Key: undefined,
    transcriptS3Key: undefined,
  };
}

async function hydrateSessionMedia(session) {
  if (!session) return session;

  let recordingUrl = session.recordingUrl || null;
  let transcriptUrl = session.transcriptUrl || null;

  if (session.recordingS3Key && wherebyS3.isConfigured()) {
    recordingUrl = await wherebyS3.getPresignedObjectUrl(session.recordingS3Key);
  }
  if (session.transcriptS3Key && wherebyS3.isConfigured()) {
    transcriptUrl = await wherebyS3.getPresignedObjectUrl(session.transcriptS3Key);
  }

  return {
    ...session,
    recordingUrl,
    transcriptUrl,
  };
}

function isUpcomingSession(session) {
  const now = Date.now();
  const status = String(session?.status || '').toLowerCase();
  if (status === 'live') return true;
  if (status === 'ended' || status === 'cancelled') return false;

  const endsAt = Date.parse(session?.endsAt || '');
  if (Number.isFinite(endsAt)) return endsAt >= now;

  const startsAt = Date.parse(session?.startsAt || '');
  return Number.isFinite(startsAt) ? startsAt >= now : false;
}

async function listVisibleSessions(strapi, access, { onlyUpcoming = false } = {}) {
  const sessions = await strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
    sort: { startsAt: onlyUpcoming ? 'asc' : 'desc' },
    limit: 300,
    populate: {
      trainer: { populate: ['user'] },
      course: true,
      cluster: true,
    },
  });

  const visible = sessions
    .filter((session) => hasSessionAccess(session, access))
    .filter((session) => !onlyUpcoming || isUpcomingSession(session))
    .map((session) => sanitizeSessionForUser(session, access));

  return Promise.all(visible.map((session) => hydrateSessionMedia(session)));
}

async function backfillMissingSessionRecordings(strapi, sessions, { limit = 10 } = {}) {
  if (!wherebyS3.isConfigured() || !Array.isArray(sessions) || sessions.length === 0) {
    return;
  }

  const candidates = sessions
    .filter((session) => !session.recordingUrl)
    .filter((session) => Array.isArray(session.attendees) && session.attendees.length > 0)
    .slice(0, limit);

  await Promise.all(candidates.map(async (session) => {
    try {
      const fullSession = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', session.id, {
        populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
      });
      if (!fullSession?.recordingS3Key && !fullSession?.recordingUrl) {
        await syncSessionMediaFromStorage(strapi, fullSession);
      }
    } catch (error) {
      strapi.log.warn(`Failed to backfill recording for session ${session.id}`, error);
    }
  }));
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object') || null;
}

function extractWebhookPayload(payload) {
  const data = firstObject(payload?.data, payload?.payload, payload?.eventData, payload?.object) || {};
  const recording = firstObject(payload?.recording, data?.recording, payload?.recordingData, data?.recordingData) || {};
  const transcript = firstObject(payload?.transcript, data?.transcript, payload?.transcription, data?.transcription) || {};
  const eventType = firstString(payload?.event, payload?.type, payload?.topic, payload?.name, data?.event, data?.type).toLowerCase();
  const status = firstString(payload?.status, recording?.status, data?.status, transcript?.status).toLowerCase();
  const meetingId = firstString(
    payload?.meetingId,
    payload?.roomId,
    payload?.sessionId,
    data?.meetingId,
    data?.roomId,
    data?.sessionId,
    recording?.meetingId,
    recording?.roomId,
    recording?.sessionId
  );
  const recordingId = firstString(
    payload?.recordingId,
    data?.recordingId,
    recording?.recordingId,
    recording?.id
  );
  const transcriptionId = firstString(
    payload?.transcriptionId,
    data?.transcriptionId,
    transcript?.transcriptionId,
    transcript?.id
  );
  const filename = firstString(
    payload?.filename,
    data?.filename,
    recording?.filename,
    transcript?.filename
  );
  const recordingUrl = firstString(
    payload?.recordingUrl,
    payload?.downloadUrl,
    payload?.url,
    data?.recordingUrl,
    data?.downloadUrl,
    data?.url,
    recording?.downloadUrl,
    recording?.url,
    recording?.fileUrl,
    recording?.file?.url,
    recording?.links?.download,
    recording?.links?.self
  );
  const transcriptUrl = firstString(
    payload?.transcriptUrl,
    data?.transcriptUrl,
    transcript?.url,
    transcript?.downloadUrl,
    transcript?.fileUrl,
    transcript?.accessLink
  );

  return {
    eventType,
    status,
    meetingId,
    recordingId,
    transcriptionId,
    filename,
    recordingUrl,
    transcriptUrl,
  };
}

function shouldSyncRecording(details) {
  if (!details?.meetingId) return false;
  if (!details.recordingUrl && !details.filename && !details.recordingId) return false;

  const fingerprint = `${details.eventType} ${details.status}`;
  if (!fingerprint.trim()) return true;
  return /(record|cloud_recording|recording\.finished)/.test(fingerprint)
    && /(stop|complete|ready|available|uploaded|finish|finished)/.test(fingerprint);
}

function shouldSyncTranscription(details) {
  if (!details?.meetingId) return false;
  if (!details.transcriptUrl && !details.transcriptionId && !details.filename) return false;

  const fingerprint = `${details.eventType} ${details.status}`;
  if (!fingerprint.trim()) return true;
  return /(transcript|transcription)/.test(fingerprint)
    && /(stop|complete|ready|available|uploaded|finish|finished)/.test(fingerprint);
}

async function resolveRecordingUrl(details) {
  if (details.recordingUrl) return details.recordingUrl;

  if (details.filename && wherebyS3.isConfigured()) {
    return wherebyS3.getPresignedObjectUrl(details.filename);
  }

  if (details.recordingId && whereby.isEnabled()) {
    const access = await whereby.getRecordingAccessLink(details.recordingId);
    return firstString(access?.accessLink, access?.url, access?.downloadUrl);
  }

  return null;
}

async function resolveTranscriptUrl(details) {
  if (details.transcriptUrl) return details.transcriptUrl;

  if (details.filename && wherebyS3.isConfigured()) {
    return wherebyS3.getPresignedObjectUrl(details.filename);
  }

  if (details.transcriptionId && whereby.isEnabled()) {
    const access = await whereby.getTranscriptionAccessLink(details.transcriptionId);
    return firstString(access?.accessLink, access?.url, access?.downloadUrl);
  }

  return null;
}

async function uploadRemoteRecording(session, sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to fetch recording source: ${response.status} ${response.statusText}`);
  }

  const startedAt = session?.startsAt ? new Date(session.startsAt) : new Date();
  const ext = inferExtension({
    sourceUrl,
    contentType: response.headers.get('content-type'),
    fallback: '.mp4',
  });
  const safeTitle = sanitizeKeySegment(session?.title, 'session-recording');
  const key = [
    'entrep-session-recordings',
    String(session.id),
    `${startedAt.toISOString().slice(0, 10)}-${safeTitle}-${crypto.randomBytes(4).toString('hex')}${ext}`,
  ].join('/');

  return uploadStreamToStorage({
    key,
    body: toNodeReadableStream(response.body),
    contentType: response.headers.get('content-type') || 'video/mp4',
    cacheControl: 'public, max-age=31536000, immutable',
  });
}

async function notifyRecordingAvailable(strapi, session) {
  const learnerUserIds = session?.course?.id ? await listCourseLearnerIds(strapi, session.course.id) : [];
  const trainerUserId = Number(session?.trainer?.user?.id || 0);
  const recipientIds = [...new Set([...learnerUserIds, trainerUserId].filter(Boolean))];

  if (recipientIds.length === 0) return;

  await notifyUsers(strapi, recipientIds, {
    actorId: trainerUserId || null,
    type: 'live_session',
    title: `Recording ready: ${session.title}`,
    message: 'The live session recording is now available on your entrepreneur dashboard.',
    actionUrl: session.course?.id ? '/entrepreneur/dashboard' : `/entrepreneur/sessions/${session.id}`,
    metadata: {
      sessionId: session.id,
      courseId: Number(session?.course?.id || 0) || null,
      recordingUrl: session.recordingUrl,
    },
  });
}

async function findSessionByMeetingId(strapi, meetingId) {
  const sessions = await strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
    filters: { wherebyMeetingId: meetingId },
    limit: 1,
    populate: {
      trainer: { populate: ['user'] },
      course: true,
      cluster: true,
    },
  });
  return sessions?.[0] || null;
}

async function persistSessionMedia(strapi, session, {
  recordingUrl,
  transcriptUrl,
  recordingS3Key,
  transcriptS3Key,
  notifyRecording = false,
} = {}) {
  const data = {};
  if (recordingS3Key && recordingS3Key !== session.recordingS3Key) data.recordingS3Key = recordingS3Key;
  if (transcriptS3Key && transcriptS3Key !== session.transcriptS3Key) data.transcriptS3Key = transcriptS3Key;
  if (recordingUrl && recordingUrl !== session.recordingUrl) data.recordingUrl = recordingUrl;
  if (transcriptUrl && transcriptUrl !== session.transcriptUrl) data.transcriptUrl = transcriptUrl;
  if (!Object.keys(data).length) return session;

  const updated = await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
    data,
    populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
  });

  if (notifyRecording && updated.recordingUrl) {
    await notifyRecordingAvailable(strapi, updated);
  }

  return updated;
}

async function syncRecordingForMeeting(strapi, details) {
  const session = await findSessionByMeetingId(strapi, details.meetingId);
  if (!session) return null;

  if (session.recordingUrl) {
    const transcriptUrl = await resolveTranscriptUrl(details);
    return persistSessionMedia(strapi, session, { transcriptUrl });
  }

  if (details.filename && wherebyS3.isConfigured()) {
    const linked = await linkRecordingFromS3(session, details.filename);
    const transcriptUrl = await resolveTranscriptUrl(details);
    return persistSessionMedia(strapi, session, {
      recordingUrl: linked.recordingUrl,
      recordingS3Key: linked.recordingS3Key,
      transcriptUrl,
      notifyRecording: true,
    });
  }

  const recordingUrl = await resolveRecordingUrl(details);
  const transcriptUrl = await resolveTranscriptUrl(details);

  if (recordingUrl) {
    const uploaded = await uploadRemoteRecording(session, recordingUrl);
    return persistSessionMedia(strapi, session, {
      recordingUrl: uploaded.url,
      transcriptUrl,
      notifyRecording: true,
    });
  }

  return syncSessionMediaFromStorage(strapi, session);
}

async function syncTranscriptionForMeeting(strapi, details) {
  const session = await findSessionByMeetingId(strapi, details.meetingId);
  if (!session) return null;

  const transcriptUrl = await resolveTranscriptUrl(details);
  if (!transcriptUrl) return session;

  return persistSessionMedia(strapi, session, { transcriptUrl });
}

async function importRecordingFromS3(session, s3Key) {
  const presignedUrl = await wherebyS3.getPresignedObjectUrl(s3Key);
  if (!presignedUrl) {
    throw new Error(`Unable to create download URL for recording object: ${s3Key}`);
  }
  return uploadRemoteRecording(session, presignedUrl);
}

async function importTranscriptFromS3(session, s3Key) {
  const presignedUrl = await wherebyS3.getPresignedObjectUrl(s3Key);
  if (!presignedUrl) return null;

  const response = await fetch(presignedUrl);
  if (!response.ok || !response.body) return null;

  const startedAt = session?.startsAt ? new Date(session.startsAt) : new Date();
  const ext = inferExtension({
    sourceUrl: s3Key,
    contentType: response.headers.get('content-type'),
    fallback: '.md',
  });
  const safeTitle = sanitizeKeySegment(session?.title, 'session-transcript');
  const key = [
    'entrep-session-transcripts',
    String(session.id),
    `${startedAt.toISOString().slice(0, 10)}-${safeTitle}-${crypto.randomBytes(4).toString('hex')}${ext}`,
  ].join('/');

  const uploaded = await uploadStreamToStorage({
    key,
    body: toNodeReadableStream(response.body),
    contentType: response.headers.get('content-type') || 'text/markdown',
    cacheControl: 'public, max-age=31536000, immutable',
  });

  return uploaded.url;
}

async function findWherebyHostedRecordingUrl(session) {
  if (!whereby.isEnabled()) return null;

  const sessionStart = Date.parse(session?.startsAt || '');
  if (!Number.isFinite(sessionStart)) return null;

  let cursor;
  let bestMatch = null;

  do {
    const page = await whereby.listRecordings({ cursor, limit: 50 });
    for (const recording of page?.results || []) {
      const recordingStart = Date.parse(recording?.startDate || '');
      if (!Number.isFinite(recordingStart)) continue;
      const delta = Math.abs(recordingStart - sessionStart);
      if (delta > 6 * 60 * 60 * 1000) continue;
      if (!bestMatch || delta < bestMatch.delta) {
        bestMatch = { recording, delta };
      }
    }
    cursor = page?.cursor || null;
  } while (cursor && !bestMatch);

  if (!bestMatch?.recording?.recordingId) return null;

  const access = await whereby.getRecordingAccessLink(bestMatch.recording.recordingId);
  return firstString(access?.accessLink, access?.url, access?.downloadUrl);
}

async function linkRecordingFromS3(session, s3Key) {
  const recordingUrl = await wherebyS3.getPresignedObjectUrl(s3Key);
  return {
    recordingS3Key: s3Key,
    recordingUrl,
  };
}

async function linkTranscriptFromS3(session, s3Key) {
  const transcriptUrl = await wherebyS3.getPresignedObjectUrl(s3Key);
  return {
    transcriptS3Key: s3Key,
    transcriptUrl,
  };
}

async function syncSessionMediaFromStorage(strapi, session) {
  if (session.recordingS3Key || session.recordingUrl) {
    return hydrateSessionMedia(session);
  }

  let recordingUrl = null;
  let transcriptUrl = session.transcriptUrl || null;
  let recordingS3Key = null;
  let transcriptS3Key = session.transcriptS3Key || null;
  let notifyRecording = false;

  if (wherebyS3.isConfigured()) {
    const recordingMatch = await wherebyS3.findRecordingForSession(session);
    if (recordingMatch?.key) {
      const linked = await linkRecordingFromS3(session, recordingMatch.key);
      recordingS3Key = linked.recordingS3Key;
      recordingUrl = linked.recordingUrl;
      notifyRecording = true;

      if (!transcriptS3Key) {
        const transcriptMatch = await wherebyS3.findTranscriptForSession(session, {
          nearTime: recordingMatch.mediaTime,
        });
        if (transcriptMatch?.key) {
          const linkedTranscript = await linkTranscriptFromS3(session, transcriptMatch.key);
          transcriptS3Key = linkedTranscript.transcriptS3Key;
          transcriptUrl = linkedTranscript.transcriptUrl;
        }
      }
    } else if (!transcriptS3Key) {
      const transcriptMatch = await wherebyS3.findTranscriptForSession(session);
      if (transcriptMatch?.key) {
        const linkedTranscript = await linkTranscriptFromS3(session, transcriptMatch.key);
        transcriptS3Key = linkedTranscript.transcriptS3Key;
        transcriptUrl = linkedTranscript.transcriptUrl;
      }
    }
  }

  if (!recordingUrl) {
    const hostedUrl = await findWherebyHostedRecordingUrl(session);
    if (hostedUrl) {
      const uploaded = await uploadRemoteRecording(session, hostedUrl);
      recordingUrl = uploaded.url;
      notifyRecording = true;
    }
  }

  if (!recordingUrl && !transcriptUrl) return session;

  const updated = await persistSessionMedia(strapi, session, {
    recordingUrl,
    transcriptUrl,
    recordingS3Key,
    transcriptS3Key,
    notifyRecording,
  });

  return hydrateSessionMedia(updated);
}

function getSessionEventColor(profile, audience) {
  if (audience === 'alumni') return '#16a34a';
  if (profile?.role === 'provider') return '#dc2626';
  return profile?.preferredEventColor || '#2563eb';
}

function isMockSession(session) {
  return String(session?.wherebyMeetingId || '').startsWith('mock_')
    || String(session?.viewerRoomUrl || '').includes('movo-entrepreneur.whereby.com')
    || String(session?.hostRoomUrl || '').includes('movo-entrepreneur.whereby.com');
}

function needsCloudMediaUpgrade(session) {
  return whereby.isEnabled()
    && wherebyS3.isConfigured()
    && (!session?.cloudMediaEnabled || isMockSession(session));
}

function canUpgradeMeeting(session) {
  const attendeeCount = Array.isArray(session?.attendees) ? session.attendees.length : 0;
  return attendeeCount === 0 || session?.status === 'scheduled';
}

async function recreateCloudMeeting(strapi, session) {
  const startsAtDate = new Date(session.startsAt);
  const fallbackStart = new Date(Date.now() + 5 * 60_000);
  const resolvedStartsAt = Number.isNaN(startsAtDate.getTime()) || startsAtDate.getTime() < Date.now()
    ? fallbackStart.toISOString()
    : session.startsAt;
  const resolvedEndsAt = session.endsAt || new Date(
    new Date(resolvedStartsAt).getTime() + (Number(session.durationMinutes) || 60) * 60_000
  ).toISOString();

  const oldMeetingId = session.wherebyMeetingId;
  const meeting = await whereby.createMeeting({
    startsAt: resolvedStartsAt,
    endsAt: resolvedEndsAt,
  });

  if (oldMeetingId && !String(oldMeetingId).startsWith('mock_')) {
    await whereby.deleteMeeting(oldMeetingId).catch(() => {});
  }

  return strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
    data: {
      startsAt: resolvedStartsAt,
      endsAt: resolvedEndsAt,
      provider: 'whereby',
      hostRoomUrl: meeting.hostRoomUrl,
      viewerRoomUrl: meeting.viewerRoomUrl,
      wherebyMeetingId: meeting.meetingId,
      cloudMediaEnabled: true,
    },
    populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
  });
}

async function ensureCloudMeeting(strapi, session) {
  if (!whereby.isEnabled()) return session;
  if (!needsCloudMediaUpgrade(session)) return session;
  if (!canUpgradeMeeting(session)) return session;

  return recreateCloudMeeting(strapi, session);
}

module.exports = createCoreController('api::entrep-live-session.entrep-live-session', ({ strapi }) => ({
  /**
   * POST /entrep/live-sessions
   * Body: { title, description, topic, startsAt, endsAt, durationMinutes, courseId?, clusterId? }
   * Creates a Whereby meeting, persists session, and creates a calendar event.
   */
  async schedule(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getTrainerProfile(strapi, user.id);
    if (!profile || (!['trainer', 'admin', 'provider'].includes(profile.role) && !profile.isAlumni)) {
      return ctx.forbidden('Only trainers, providers, admins or alumni members can schedule sessions');
    }

    const { title, description, topic, startsAt, endsAt, durationMinutes = 60, courseId, clusterId, alumniAudience } = ctx.request.body || {};
    if (!title || !startsAt) return ctx.badRequest('title and startsAt are required');

    const requestedAlumniAudience = normalizeAlumniAudience(alumniAudience, profile?.alumniMemberType || null);
    const isAlumniSession = Boolean(requestedAlumniAudience);
    if (isAlumniSession && !hasAlumniAccess(profile, requestedAlumniAudience) && !isAdminUser(user, profile)) {
      return ctx.forbidden('You can only schedule sessions for your own alumni network');
    }

    const meeting = await whereby.createMeeting({
      startsAt,
      endsAt: endsAt || new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
    });

    const session = await strapi.entityService.create('api::entrep-live-session.entrep-live-session', {
      data: {
        title,
        description,
        topic,
        startsAt,
        endsAt: endsAt || meeting.endsAt,
        durationMinutes,
        trainer: profile.id,
        course: isAlumniSession ? null : (courseId || null),
        cluster: isAlumniSession ? null : (clusterId || null),
        provider: 'whereby',
        hostRoomUrl: meeting.hostRoomUrl,
        viewerRoomUrl: meeting.viewerRoomUrl,
        wherebyMeetingId: meeting.meetingId,
        cloudMediaEnabled: Boolean(wherebyS3.isConfigured()),
        status: 'scheduled',
        audience: isAlumniSession ? 'alumni' : (courseId ? 'course' : (clusterId ? 'cluster' : 'public')),
        alumniAudience: isAlumniSession ? requestedAlumniAudience : null,
      },
    });

    // Auto-create calendar event so it shows up for students
    await strapi.entityService.create('api::entrep-event.entrep-event', {
      data: {
        title: `Live: ${title}`,
        description,
        eventType: 'live_session',
        startsAt,
        endsAt: endsAt || meeting.endsAt,
        course: isAlumniSession ? null : (courseId || null),
        liveSession: session.id,
        visibility: isAlumniSession ? 'alumni' : (courseId ? 'course' : 'public'),
        alumniAudience: isAlumniSession ? requestedAlumniAudience : null,
        color: getSessionEventColor(profile, isAlumniSession ? 'alumni' : 'public'),
      },
    });

    if (isAlumniSession) {
      const alumniRecipientIds = await listAlumniRecipientIds(strapi, requestedAlumniAudience, user.id);
      if (alumniRecipientIds.length) {
        await notifyUsers(strapi, alumniRecipientIds, {
          actorId: user.id,
          type: 'live_session',
          title: `New alumni live session: ${title}`,
          message: 'A live session has been scheduled in your alumni network.',
          actionUrl: `/entrepreneur/sessions/${session.id}`,
          metadata: {
            sessionId: session.id,
            alumniAudience: requestedAlumniAudience,
          },
        });
      }

      await strapi.entityService.create('api::entrep-post.entrep-post', {
        data: {
          author: user.id,
          title: `Live session: ${title}`,
          authorName: profile?.fullName || user.username,
          authorRole: profile?.role || 'learner',
          content: String(description || topic || 'A new alumni live session has been scheduled.').trim(),
          mediaUrls: [],
          tags: [],
          isAnonymous: false,
          postType: 'community',
          audience: 'alumni',
          alumniAudience: requestedAlumniAudience,
          isExpert: profile?.isMentor || ['trainer', 'admin'].includes(profile?.role),
          status: 'published',
        },
      });
    } else if (courseId) {
      const learnerUserIds = await listCourseLearnerIds(strapi, courseId);
      await notifyUsers(strapi, learnerUserIds, {
        actorId: user.id,
        type: 'live_session',
        title: `New live session: ${title}`,
        message: `A live session has been scheduled for your course. Tap to view the session details.`,
        actionUrl: `/entrepreneur/sessions/${session.id}`,
        metadata: {
          sessionId: session.id,
          courseId: Number(courseId),
        },
      });
    }

    ctx.send({ session });
  },

  async mine(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const access = await buildSessionAccessContext(strapi, user);
    let sessions = await listVisibleSessions(strapi, access);
    await backfillMissingSessionRecordings(strapi, sessions);
    sessions = await listVisibleSessions(strapi, access);
    ctx.send({ data: sessions });
  },

  /**
   * GET /entrep/live-sessions/upcoming  – upcoming sessions visible to current user.
   */
  async upcoming(ctx) {
    const user = await resolveUser(strapi, ctx);
    const access = await buildSessionAccessContext(strapi, user);
    const requestedAudience = String(ctx.query?.audience || '').trim().toLowerCase();
    const requestedAlumniAudience = normalizeAlumniAudience(ctx.query?.alumniAudience, null);
    let sessions = await listVisibleSessions(strapi, access, { onlyUpcoming: true });

    if (requestedAudience === 'alumni') {
      sessions = sessions.filter((session) => String(session?.audience || '').toLowerCase() === 'alumni');
      if (requestedAlumniAudience) {
        sessions = sessions.filter((session) => normalizeAlumniAudience(session?.alumniAudience, null) === requestedAlumniAudience);
      }
    } else if (requestedAudience === 'public' || requestedAudience === 'course' || requestedAudience === 'cluster') {
      sessions = sessions.filter((session) => String(session?.audience || '').toLowerCase() === requestedAudience);
    }

    ctx.send({ data: sessions });
  },

  /**
   * GET /entrep/live-sessions/:id/join  – returns the appropriate room URL for the user.
   */
  async join(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const access = await buildSessionAccessContext(strapi, user);
    let session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });
    if (!session) return ctx.notFound();
    if (!hasSessionAccess(session, access)) {
      return ctx.forbidden('You do not have access to this live session');
    }
    session = await ensureCloudMeeting(strapi, session);
    const trainerProfile = await getTrainerProfile(strapi, user.id);
    const isHost = session.trainer?.user?.id === user.id;
    const isModerator = trainerProfile && ['admin'].includes(trainerProfile.role);

    const attendees = Array.isArray(session.attendees) ? [...session.attendees] : [];
    if (!attendees.find((a) => a.userId === user.id)) {
      attendees.push({ userId: user.id, joinedAt: new Date().toISOString() });
      await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
        data: { attendees, status: session.status === 'ended' ? 'ended' : 'live' },
      });
      session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', session.id, {
        populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
      });
    }

    if (!session.recordingS3Key && !session.recordingUrl) {
      try {
        session = await syncSessionMediaFromStorage(strapi, session);
      } catch (error) {
        strapi.log.warn('Session join media sync failed', error);
        session = await hydrateSessionMedia(session);
      }
    } else {
      session = await hydrateSessionMedia(session);
    }

    ctx.send({
      roomUrl: isHost || isModerator ? session.hostRoomUrl : session.viewerRoomUrl,
      isHost: !!(isHost || isModerator),
      cloudRecordingEnabled: Boolean(session.cloudMediaEnabled),
      session: {
        id: session.id,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        status: session.status === 'ended' ? 'ended' : 'live',
        recordingUrl: session.recordingUrl || null,
        transcriptUrl: session.transcriptUrl || null,
      },
    });
  },

  async streamRecording(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const access = await buildSessionAccessContext(strapi, user);
    const session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });
    if (!session) return ctx.notFound();
    if (!hasSessionAccess(session, access)) {
      return ctx.forbidden('You do not have access to this recording');
    }

    const sourceKey = session.recordingS3Key;
    if (!sourceKey || !wherebyS3.isConfigured()) {
      if (session.recordingUrl) {
        ctx.redirect(session.recordingUrl);
        return;
      }
      return ctx.notFound('Recording not available');
    }

    try {
      const object = await wherebyS3.getObjectStream(sourceKey);
      if (!object?.body) return ctx.notFound('Recording not available');

      const safeTitle = sanitizeKeySegment(session.title, 'session-recording');
      ctx.set('Content-Type', object.contentType || 'video/mp4');
      ctx.set('Content-Disposition', `inline; filename="${safeTitle}.mp4"`);
      ctx.set('Accept-Ranges', 'bytes');
      if (object.contentLength) {
        ctx.set('Content-Length', String(object.contentLength));
      }
      ctx.body = object.body;
    } catch (error) {
      strapi.log.error('Failed to stream session recording', error);
      ctx.badRequest('Unable to stream recording');
    }
  },

  async refreshRoom(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getTrainerProfile(strapi, user.id);
    let session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });
    if (!session) return ctx.notFound();

    const isHost = Number(session?.trainer?.user?.id || 0) === Number(user.id);
    const isAdmin = isAdminUser(user, profile);
    if (!isHost && !isAdmin) {
      return ctx.forbidden('Only the session host can refresh the meeting room');
    }

    const attendeeCount = Array.isArray(session.attendees) ? session.attendees.length : 0;
    if (attendeeCount > 0) {
      return ctx.badRequest('Refresh the room only before other participants have joined');
    }

    try {
      session = await recreateCloudMeeting(strapi, session);
      ctx.send({
        data: {
          id: session.id,
          roomUrl: session.hostRoomUrl,
          cloudRecordingEnabled: true,
        },
      });
    } catch (error) {
      strapi.log.error('Failed to refresh Whereby room', error);
      ctx.badRequest('Unable to refresh meeting room');
    }
  },

  async end(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getTrainerProfile(strapi, user.id);
    const session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });
    if (!session) return ctx.notFound();

    const isHost = Number(session?.trainer?.user?.id || 0) === Number(user.id);
    const isAdmin = isAdminUser(user, profile);
    if (!isHost && !isAdmin) {
      return ctx.forbidden('Only the session host can end this session');
    }

    let updated = await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
      data: { status: 'ended' },
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });

    try {
      updated = await syncSessionMediaFromStorage(strapi, updated);
    } catch (error) {
      strapi.log.warn('Session ended but media sync failed', error);
    }

    ctx.send({ data: sanitizeSessionForUser(updated, { user, isAdmin, profile }) });
  },

  async syncMedia(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const access = await buildSessionAccessContext(strapi, user);
    const session = await strapi.entityService.findOne('api::entrep-live-session.entrep-live-session', ctx.params.id, {
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });
    if (!session) return ctx.notFound();
    if (!hasSessionAccess(session, access)) return ctx.forbidden('You do not have access to this live session');

    const isHost = Number(session?.trainer?.user?.id || 0) === Number(user.id);
    if (!isHost && !access.isAdmin) {
      return ctx.forbidden('Only the session host can sync session media');
    }

    try {
      const updated = await syncSessionMediaFromStorage(strapi, session);
      ctx.send({
        data: {
          id: updated.id,
          recordingUrl: updated.recordingUrl || null,
          transcriptUrl: updated.transcriptUrl || null,
          recordingSaved: Boolean(updated.recordingUrl),
        },
      });
    } catch (error) {
      strapi.log.error('Failed to sync session media', error);
      ctx.badRequest('Unable to sync session media');
    }
  },

  async wherebyWebhook(ctx) {
    const details = extractWebhookPayload(ctx.request.body || {});

    try {
      if (shouldSyncRecording(details)) {
        const session = await syncRecordingForMeeting(strapi, details);
        ctx.send({
          ok: true,
          sessionId: session?.id || null,
          syncedRecording: Boolean(session?.recordingUrl),
          syncedTranscript: Boolean(session?.transcriptUrl),
        });
        return;
      }

      if (shouldSyncTranscription(details)) {
        const session = await syncTranscriptionForMeeting(strapi, details);
        ctx.send({
          ok: true,
          sessionId: session?.id || null,
          syncedTranscript: Boolean(session?.transcriptUrl),
        });
        return;
      }

      ctx.send({ ok: true, ignored: true });
    } catch (error) {
      strapi.log.error('Failed to sync Whereby webhook payload', error);
      ctx.badRequest('Unable to sync Whereby webhook payload');
    }
  },
}));
