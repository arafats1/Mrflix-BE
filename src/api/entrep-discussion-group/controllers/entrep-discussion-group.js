'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const whereby = require('../../../utils/whereby');

async function resolveUser(strapi, ctx) {
  if (!ctx.state.user?.id) return null;
  return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id);
}

async function listEligibleEnrollments(strapi, userId) {
  return strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: {
      user: userId,
      status: { $in: ['active', 'completed'] },
    },
    populate: ['course'],
    sort: { enrolledAt: 'desc' },
  });
}

async function findGroupByCourseId(strapi, courseId) {
  const list = await strapi.entityService.findMany('api::entrep-discussion-group.entrep-discussion-group', {
    filters: {
      course: { id: courseId },
      status: 'active',
    },
    populate: {
      course: true,
      members: true,
      creator: true,
    },
    limit: 1,
  });
  return list?.[0] || null;
}

async function findGroupById(strapi, groupId) {
  if (!groupId) return null;
  return strapi.entityService.findOne('api::entrep-discussion-group.entrep-discussion-group', groupId, {
    populate: {
      course: true,
      members: true,
      creator: true,
    },
  });
}

function serializeGroupPreview(course, group, userId) {
  const memberIds = Array.isArray(group?.members)
    ? group.members.map((member) => Number(member?.id || member)).filter(Boolean)
    : [];

  return {
    id: group?.id || null,
    title: group?.title || `${course?.title || 'Course'} Discussion Group`,
    description: group?.description || `Private learner discussion space for ${course?.title || 'this course'}.`,
    joined: userId ? memberIds.includes(Number(userId)) : false,
    canCreate: !group,
    memberCount: memberIds.length,
    course: course ? {
      id: course.id,
      title: course.title,
      accent: course.accent || '🎓',
      coverGradient: course.coverGradient || null,
      coverUrl: course.coverUrl || null,
      category: course.category || null,
    } : null,
  };
}

async function getEnrolledCourse(strapi, userId, courseId) {
  const enrollments = await listEligibleEnrollments(strapi, userId);
  const enrollment = enrollments.find((item) => Number(item?.course?.id) === Number(courseId));
  return enrollment?.course || null;
}

module.exports = createCoreController('api::entrep-discussion-group.entrep-discussion-group', ({ strapi }) => ({
  async mine(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const enrollments = await listEligibleEnrollments(strapi, user.id);
    const uniqueCourses = new Map();
    enrollments.forEach((enrollment) => {
      if (enrollment?.course?.id && !uniqueCourses.has(Number(enrollment.course.id))) {
        uniqueCourses.set(Number(enrollment.course.id), enrollment.course);
      }
    });

    const groups = await Promise.all(
      [...uniqueCourses.keys()].map(async (courseId) => {
        const course = uniqueCourses.get(courseId);
        const group = await findGroupByCourseId(strapi, courseId);
        return serializeGroupPreview(course, group, user.id);
      })
    );

    ctx.send({ data: groups });
  },

  async joinCourseGroup(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const courseId = Number(ctx.params.courseId);
    if (!Number.isFinite(courseId) || courseId <= 0) return ctx.badRequest('Valid courseId required');

    const course = await getEnrolledCourse(strapi, user.id, courseId);
    if (!course) return ctx.forbidden('You can only join discussion groups for your enrolled courses');

    const group = await findGroupByCourseId(strapi, courseId);
    if (!group) return ctx.notFound('Discussion group not found');

    const memberIds = Array.isArray(group.members)
      ? group.members.map((member) => Number(member?.id || member)).filter(Boolean)
      : [];

    if (!memberIds.includes(user.id)) {
      memberIds.push(user.id);
    }

    const updated = await strapi.entityService.update('api::entrep-discussion-group.entrep-discussion-group', group.id, {
      data: {
        members: memberIds,
      },
      populate: {
        course: true,
        members: true,
        creator: true,
      },
    });

    ctx.send({ group: serializeGroupPreview(updated.course, updated, user.id) });
  },

  async createCourseGroup(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const courseId = Number(ctx.params.courseId);
    if (!Number.isFinite(courseId) || courseId <= 0) return ctx.badRequest('Valid courseId required');

    const course = await getEnrolledCourse(strapi, user.id, courseId);
    if (!course) return ctx.forbidden('You can only create discussion groups for your enrolled courses');

    const existing = await findGroupByCourseId(strapi, courseId);
    if (existing) {
      return ctx.badRequest('A discussion group for this course already exists');
    }

    const body = ctx.request.body || {};
    const title = String(body.title || `${course.title} Discussion Group`).trim();
    const description = String(
      body.description
      || `Private learner discussion space for ${course.title}. Share questions, progress, and practical ideas with fellow learners.`
    ).trim();

    const created = await strapi.entityService.create('api::entrep-discussion-group.entrep-discussion-group', {
      data: {
        title,
        description,
        course: course.id,
        creator: user.id,
        members: [user.id],
        status: 'active',
      },
      populate: {
        course: true,
        members: true,
        creator: true,
      },
    });

    ctx.send({ group: serializeGroupPreview(created.course, created, user.id) });
  },

  async createMeetingLink(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const groupId = Number(ctx.params.id);
    if (!Number.isFinite(groupId) || groupId <= 0) return ctx.badRequest('Valid group id required');

    const group = await findGroupById(strapi, groupId);
    if (!group || group.status !== 'active') return ctx.notFound('Discussion group not found');

    const memberIds = Array.isArray(group.members)
      ? group.members.map((member) => Number(member?.id || member)).filter(Boolean)
      : [];

    if (!memberIds.includes(Number(user.id))) {
      return ctx.forbidden('Join this discussion group before generating a meeting link');
    }

    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const meeting = await whereby.createMeeting({ startsAt, endsAt, roomMode: 'group' });

    ctx.send({
      meeting: {
        provider: 'whereby',
        startsAt,
        endsAt,
        roomUrl: meeting.viewerRoomUrl,
        hostRoomUrl: meeting.hostRoomUrl,
        meetingId: meeting.meetingId,
        course: group.course ? { id: group.course.id, title: group.course.title || 'Course' } : null,
        discussionGroupId: group.id,
      },
    });
  },
}));