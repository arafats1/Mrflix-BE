'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');
const whereby = require('../../../utils/whereby');
const { listCourseLearnerIds, notifyUsers } = require('../../../utils/entrep-notifications');
const { inferExtension, sanitizeKeySegment, toNodeReadableStream, uploadStreamToStorage } = require('../../../utils/storage');

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
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

  if (!access?.user) {
    return !courseId && !clusterId;
  }

  if (trainerUserId && trainerUserId === Number(access.user.id)) return true;
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

  return sessions
    .filter((session) => hasSessionAccess(session, access))
    .filter((session) => !onlyUpcoming || isUpcomingSession(session))
    .map((session) => sanitizeSessionForUser(session, access));
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

function extractRecordingPayload(payload) {
  const data = firstObject(payload?.data, payload?.payload, payload?.eventData, payload?.object) || {};
  const recording = firstObject(payload?.recording, data?.recording, payload?.recordingData, data?.recordingData) || {};
  const transcript = firstObject(payload?.transcript, data?.transcript) || {};
  const eventType = firstString(payload?.event, payload?.type, payload?.topic, payload?.name, data?.event, data?.type).toLowerCase();
  const status = firstString(payload?.status, recording?.status, data?.status).toLowerCase();
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
    transcript?.fileUrl
  );

  return {
    eventType,
    status,
    meetingId,
    recordingUrl,
    transcriptUrl,
  };
}

function shouldSyncRecording(details) {
  if (!details?.meetingId || !details?.recordingUrl) return false;
  const fingerprint = `${details.eventType} ${details.status}`;
  if (!fingerprint.trim()) return true;
  return /(record|cloud_recording)/.test(fingerprint) && /(stop|complete|ready|available|uploaded|finish)/.test(fingerprint);
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

async function syncRecordingForMeeting(strapi, details) {
  const sessions = await strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
    filters: { wherebyMeetingId: details.meetingId },
    limit: 1,
    populate: {
      trainer: { populate: ['user'] },
      course: true,
      cluster: true,
    },
  });
  const session = sessions?.[0];
  if (!session) return null;

  if (session.recordingUrl) {
    if (details.transcriptUrl && !session.transcriptUrl) {
      return strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
        data: {
          transcriptUrl: details.transcriptUrl,
          status: 'ended',
        },
        populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
      });
    }
    return session;
  }

  const uploaded = await uploadRemoteRecording(session, details.recordingUrl);
  const updated = await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
    data: {
      recordingUrl: uploaded.url,
      transcriptUrl: details.transcriptUrl || session.transcriptUrl || null,
      status: 'ended',
    },
    populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
  });

  await notifyRecordingAvailable(strapi, updated);
  return updated;
}

function getSessionEventColor(profile) {
  if (profile?.role === 'provider') return '#dc2626';
  return profile?.preferredEventColor || '#2563eb';
}

function isMockSession(session) {
  return String(session?.wherebyMeetingId || '').startsWith('mock_')
    || String(session?.viewerRoomUrl || '').includes('movo-entrepreneur.whereby.com')
    || String(session?.hostRoomUrl || '').includes('movo-entrepreneur.whereby.com');
}

async function ensureRealMeeting(strapi, session) {
  if (!whereby.isEnabled() || !isMockSession(session)) return session;

  const startsAtDate = new Date(session.startsAt);
  const fallbackStart = new Date(Date.now() + 5 * 60_000);
  const resolvedStartsAt = Number.isNaN(startsAtDate.getTime()) || startsAtDate.getTime() < Date.now()
    ? fallbackStart.toISOString()
    : session.startsAt;
  const resolvedEndsAt = session.endsAt || new Date(new Date(resolvedStartsAt).getTime() + (Number(session.durationMinutes) || 60) * 60_000).toISOString();

  const meeting = await whereby.createMeeting({
    startsAt: resolvedStartsAt,
    endsAt: resolvedEndsAt,
  });

  return strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
    data: {
      startsAt: resolvedStartsAt,
      endsAt: resolvedEndsAt,
      provider: 'whereby',
      hostRoomUrl: meeting.hostRoomUrl,
      viewerRoomUrl: meeting.viewerRoomUrl,
      wherebyMeetingId: meeting.meetingId,
    },
    populate: { trainer: { populate: ['user'] }, course: true },
  });
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
    if (!profile || !['trainer', 'admin', 'provider'].includes(profile.role)) {
      return ctx.forbidden('Only trainers, providers or admins can schedule sessions');
    }

    const { title, description, topic, startsAt, endsAt, durationMinutes = 60, courseId, clusterId } = ctx.request.body || {};
    if (!title || !startsAt) return ctx.badRequest('title and startsAt are required');

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
        course: courseId || null,
        cluster: clusterId || null,
        provider: 'whereby',
        hostRoomUrl: meeting.hostRoomUrl,
        viewerRoomUrl: meeting.viewerRoomUrl,
        wherebyMeetingId: meeting.meetingId,
        status: 'scheduled',
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
        course: courseId || null,
        liveSession: session.id,
        visibility: courseId ? 'course' : 'public',
        color: getSessionEventColor(profile),
      },
    });

    if (courseId) {
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
    const sessions = await listVisibleSessions(strapi, access);
    ctx.send({ data: sessions });
  },

  /**
   * GET /entrep/live-sessions/upcoming  – upcoming sessions visible to current user.
   */
  async upcoming(ctx) {
    const user = await resolveUser(strapi, ctx);
    const access = await buildSessionAccessContext(strapi, user);
    const sessions = await listVisibleSessions(strapi, access, { onlyUpcoming: true });
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
    session = await ensureRealMeeting(strapi, session);
    const trainerProfile = await getTrainerProfile(strapi, user.id);
    const isHost = session.trainer?.user?.id === user.id;
    const isModerator = trainerProfile && ['admin'].includes(trainerProfile.role);

    // Attendance
    const attendees = Array.isArray(session.attendees) ? [...session.attendees] : [];
    if (!attendees.find((a) => a.userId === user.id)) {
      attendees.push({ userId: user.id, joinedAt: new Date().toISOString() });
      await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
        data: { attendees, status: session.status === 'ended' ? 'ended' : 'live' },
      });
    }

    ctx.send({
      roomUrl: isHost || isModerator ? session.hostRoomUrl : session.viewerRoomUrl,
      isHost: !!(isHost || isModerator),
      session: {
        id: session.id,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        status: session.status === 'ended' ? 'ended' : 'live',
        recordingUrl: session.recordingUrl || null,
      },
    });
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

    const updated = await strapi.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
      data: { status: 'ended' },
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });

    ctx.send({ data: sanitizeSessionForUser(updated, { user, isAdmin, profile }) });
  },

  async wherebyWebhook(ctx) {
    const details = extractRecordingPayload(ctx.request.body || {});
    if (!shouldSyncRecording(details)) {
      ctx.send({ ok: true, ignored: true });
      return;
    }

    try {
      const session = await syncRecordingForMeeting(strapi, details);
      ctx.send({ ok: true, sessionId: session?.id || null, synced: Boolean(session?.recordingUrl) });
    } catch (error) {
      strapi.log.error('Failed to sync Whereby recording', error);
      ctx.badRequest('Unable to sync recording');
    }
  },
}));
