'use strict';

function uniqUserIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => Number(value)).filter(Boolean))];
}

function normalizeNotificationType(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'system';

  if (raw === 'lesson_question') return 'submission';
  if (raw === 'live_session_request') return 'live_session';

  return ['assignment', 'live_session', 'submission', 'grade', 'mentorship', 'system'].includes(raw)
    ? raw
    : 'system';
}

async function createNotification(strapi, payload) {
  const recipientId = Number(payload?.recipientId);
  if (!recipientId) return null;

  return strapi.entityService.create('api::entrep-notification.entrep-notification', {
    data: {
      recipient: recipientId,
      actor: payload.actorId ? Number(payload.actorId) : null,
      type: normalizeNotificationType(payload.type),
      title: String(payload.title || 'Notification').trim(),
      message: payload.message || '',
      actionUrl: payload.actionUrl || null,
      metadata: payload.metadata || {},
      readAt: null,
    },
  });
}

async function notifyUsers(strapi, recipientIds, payloadFactory) {
  const ids = uniqUserIds(recipientIds);
  await Promise.all(ids.map(async (recipientId) => {
    const payload = typeof payloadFactory === 'function'
      ? await payloadFactory(recipientId)
      : payloadFactory;

    if (!payload) return null;
    return createNotification(strapi, { ...payload, recipientId });
  }));
}

async function listCourseLearnerIds(strapi, courseId) {
  const parsedCourseId = Number(courseId);
  if (!parsedCourseId) return [];

  const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: {
      course: parsedCourseId,
      status: { $in: ['active', 'completed'] },
    },
    populate: ['user'],
    limit: 500,
  });

  return uniqUserIds(enrollments.map((enrollment) => enrollment.user?.id || enrollment.user));
}

module.exports = {
  createNotification,
  notifyUsers,
  listCourseLearnerIds,
  uniqUserIds,
};