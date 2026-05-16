'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getCoursePopulated, syncEnrollmentMetricsAndCertificate } = require('../../../utils/entrep-course-progress');
const { createNotification, listCourseLearnerIds, notifyUsers } = require('../../../utils/entrep-notifications');

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!id) return null;
    return await strapi.entityService.findOne('plugin::users-permissions.user', id, { populate: ['role'] });
  } catch {
    return null;
  }

  return null;
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
    populate: ['user'],
  });
  return list?.[0] || null;
}

function getDisplayName(user, profile, fallback = 'A learner') {
  return profile?.fullName || user?.fullName || user?.name || user?.username || user?.email || fallback;
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
}

async function getManagedCourse(strapi, user, profile, courseId) {
  const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', courseId, {
    populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
  });
  if (!course) return null;

  const isAdmin = isAdminUser(user, profile);
  const ownsCourse = profile?.id && Number(course.trainer?.id) === Number(profile.id);
  if (!isAdmin && !ownsCourse) return false;
  return course;
}

async function getProfilesByUserIds(strapi, userIds) {
  if (!userIds.length) return new Map();
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: { id: { $in: userIds } } },
    populate: ['user'],
  });
  return new Map(profiles.map((profile) => [Number(profile.user?.id), profile]));
}

function normalizeSubmissionTypes(value) {
  const allowed = new Set(['video', 'image', 'document']);
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter((entry) => allowed.has(entry));
  return normalized.length ? normalized : ['video', 'image', 'document'];
}

function serializeSubmission(submission, profilesByUserId = new Map()) {
  const learnerUserId = Number(submission.user?.id || submission.user || 0);
  const learnerProfile = profilesByUserId.get(learnerUserId);
  return {
    ...submission,
    learnerName: learnerProfile?.fullName || submission.user?.username || submission.user?.email || 'Learner',
    learnerPhotoUrl: learnerProfile?.profilePhotoUrl || '',
  };
}

module.exports = createCoreController('api::entrep-assignment.entrep-assignment', ({ strapi }) => ({
  async createForCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const course = await getManagedCourse(strapi, user, profile, ctx.params.id);
    if (course === false) return ctx.forbidden('You can only manage your own courses');
    if (!course) return ctx.notFound();

    const body = ctx.request.body || {};
    if (!body.title || !body.dueAt) return ctx.badRequest('title and dueAt are required');

    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) return ctx.badRequest('Invalid dueAt value');
    if (dueAt.getTime() <= Date.now()) return ctx.badRequest('Assignment deadline must be in the future');

    const assignment = await strapi.entityService.create('api::entrep-assignment.entrep-assignment', {
      data: {
        title: String(body.title).trim(),
        description: body.description || '',
        instructions: body.instructions || body.description || '',
        dueAt: dueAt.toISOString(),
        maxScore: Math.max(1, Number(body.maxScore) || 100),
        acceptedSubmissionTypes: normalizeSubmissionTypes(body.acceptedSubmissionTypes),
        course: course.id,
        trainer: profile?.id || null,
      },
      populate: ['course'],
    });

    await strapi.entityService.create('api::entrep-event.entrep-event', {
      data: {
        title: assignment.title,
        description: assignment.description || assignment.instructions || '',
        eventType: 'assignment_deadline',
        startsAt: assignment.dueAt,
        endsAt: assignment.dueAt,
        course: course.id,
        visibility: 'course',
        color: '#dc2626',
      },
    });

    const learnerUserIds = await listCourseLearnerIds(strapi, course.id);
    await notifyUsers(strapi, learnerUserIds, {
      actorId: user.id,
      type: 'assignment',
      title: `New assignment: ${assignment.title}`,
      message: `${course.title} has a new assignment waiting for your submission.`,
      actionUrl: '/entrepreneur/dashboard',
      metadata: {
        assignmentId: assignment.id,
        courseId: course.id,
      },
    });

    ctx.send({ data: assignment });
  },

  async myAssignments(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
      filters: { user: user.id },
      populate: ['course'],
    });
    const courseIds = enrollments.map((enrollment) => Number(enrollment.course?.id || enrollment.course)).filter(Boolean);
    if (!courseIds.length) return ctx.send({ data: [] });

    const assignments = await strapi.entityService.findMany('api::entrep-assignment.entrep-assignment', {
      filters: { course: { id: { $in: courseIds } } },
      sort: { dueAt: 'asc' },
      populate: ['course'],
    });
    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);
    const submissions = assignmentIds.length
      ? await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
          filters: { user: user.id, assignment: { id: { $in: assignmentIds } } },
          sort: { updatedAt: 'desc' },
          populate: ['assignment'],
        })
      : [];

    const latestSubmissionByAssignmentId = new Map();
    submissions.forEach((submission) => {
      const assignmentId = Number(submission.assignment?.id || submission.assignment);
      if (assignmentId && !latestSubmissionByAssignmentId.has(assignmentId)) {
        latestSubmissionByAssignmentId.set(assignmentId, submission);
      }
    });

    ctx.send({
      data: assignments.map((assignment) => ({
        ...assignment,
        mySubmission: latestSubmissionByAssignmentId.get(assignment.id) || null,
      })),
    });
  },

  async submit(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);

    const assignment = await strapi.entityService.findOne('api::entrep-assignment.entrep-assignment', ctx.params.id, {
      populate: {
        course: {
          populate: {
            trainer: {
              populate: ['user'],
            },
          },
        },
      },
    });
    if (!assignment) return ctx.notFound('Assignment not found');

    if (new Date(assignment.dueAt).getTime() < Date.now()) {
      return ctx.badRequest('The submission deadline has passed');
    }

    const enrollmentList = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
      filters: { user: user.id, course: assignment.course?.id || assignment.course },
      limit: 1,
    });
    const enrollment = enrollmentList?.[0] || null;
    if (!enrollment) return ctx.forbidden('Enroll in this course before submitting an assignment');

    const body = ctx.request.body || {};
    const submissionType = normalizeSubmissionTypes(body.submissionType)[0];
    if (!body.mediaUrl && !body.textResponse) {
      return ctx.badRequest('Upload a file or add a response before submitting');
    }

    const existing = await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
      filters: { user: user.id, assignment: assignment.id },
      limit: 1,
    });

    const now = new Date().toISOString();
    const payload = {
      user: user.id,
      course: assignment.course?.id || assignment.course,
      assignment: assignment.id,
      submissionType,
      mediaUrl: body.mediaUrl || null,
      textResponse: body.textResponse || null,
      fileName: body.fileName || null,
      status: 'submitted',
      grade: null,
      feedback: null,
      submittedAt: now,
      gradedAt: null,
    };

    const submission = existing?.[0]
      ? await strapi.entityService.update('api::entrep-submission.entrep-submission', existing[0].id, { data: payload })
      : await strapi.entityService.create('api::entrep-submission.entrep-submission', { data: payload });

    const trainerUserId = Number(assignment.course?.trainer?.user?.id || assignment.course?.trainer?.user || 0);
    if (trainerUserId) {
      await createNotification(strapi, {
        recipientId: trainerUserId,
        actorId: user.id,
        type: 'submission',
        title: `New submission for ${assignment.title}`,
        message: `${getDisplayName(user, profile)} submitted work for ${assignment.course?.title || 'your course'}.`,
        actionUrl: `/entrepreneur/trainer/courses/${assignment.course?.id || assignment.course}`,
        metadata: {
          submissionId: submission.id,
          assignmentId: assignment.id,
          courseId: assignment.course?.id || assignment.course,
        },
      });
    }

    ctx.send({ data: submission });
  },

  async gradeSubmission(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const submission = await strapi.entityService.findOne('api::entrep-submission.entrep-submission', ctx.params.id, {
      populate: {
        user: true,
        course: true,
        assignment: { populate: ['course'] },
      },
    });
    if (!submission?.assignment) return ctx.notFound('Assignment submission not found');

    const courseId = Number(submission.assignment.course?.id || submission.course?.id || submission.course);
    const course = await getManagedCourse(strapi, user, profile, courseId);
    if (course === false) return ctx.forbidden('You can only grade submissions for your own course');
    if (!course) return ctx.notFound('Course not found');

    const body = ctx.request.body || {};
    const maxScore = Math.max(1, Number(submission.assignment.maxScore || 100));
    const grade = Math.round(Number(body.grade));
    if (!Number.isFinite(grade) || grade < 0 || grade > maxScore) {
      return ctx.badRequest(`grade must be between 0 and ${maxScore}`);
    }
    const percentage = Math.round((grade / maxScore) * 100);

    const gradedAt = new Date().toISOString();
    const updatedSubmission = await strapi.entityService.update('api::entrep-submission.entrep-submission', submission.id, {
      data: {
        grade,
        feedback: body.feedback || null,
        gradedAt,
        status: percentage >= Math.max(50, Math.round(Number(course.passMark || 80) / 2)) ? 'approved' : 'needs_revision',
      },
      populate: {
        user: true,
        course: true,
        assignment: { populate: ['course'] },
      },
    });

    const enrollmentList = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
      filters: { user: submission.user?.id, course: course.id },
      limit: 1,
    });
    const enrollment = enrollmentList?.[0] || null;

    let updatedEnrollment = null;
    let certificate = null;
    if (enrollment) {
      const assignmentResults = {
        ...(enrollment.assignmentResults || {}),
        [String(submission.assignment.id)]: {
          percentage,
          rawScore: grade,
          maxScore,
          graded: true,
          submissionId: updatedSubmission.id,
          gradedAt,
          submittedAt: updatedSubmission.submittedAt || null,
          dueAt: submission.assignment.dueAt || null,
        },
      };

      const syncResult = await syncEnrollmentMetricsAndCertificate(strapi, {
        enrollment,
        course: await getCoursePopulated(strapi, course.id),
        userId: submission.user?.id,
        completedLessons: enrollment.completedLessons,
        lessonProgress: enrollment.lessonProgress,
        moduleQuizResults: enrollment.moduleQuizResults,
        assignmentResults,
      });
      updatedEnrollment = syncResult.enrollment;
      certificate = syncResult.certificate;
    }

    await createNotification(strapi, {
      recipientId: submission.user?.id,
      actorId: user.id,
      type: 'grade',
      title: `Marks sent: ${submission.assignment.title}`,
      message: body.feedback
        ? `Your work has been graded ${grade}/${maxScore}. Feedback: ${body.feedback}`
        : `Your work has been graded ${grade}/${maxScore}.`,
      actionUrl: '/entrepreneur/dashboard',
      metadata: {
        submissionId: updatedSubmission.id,
        assignmentId: submission.assignment.id,
        courseId: course.id,
        grade,
        maxScore,
      },
    });

    ctx.send({ data: updatedSubmission, enrollment: updatedEnrollment, certificate });
  },

  async listForTrainerCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const course = await getManagedCourse(strapi, user, profile, ctx.params.id);
    if (course === false) return ctx.forbidden('You can only manage your own courses');
    if (!course) return ctx.notFound();

    const assignments = await strapi.entityService.findMany('api::entrep-assignment.entrep-assignment', {
      filters: { course: course.id },
      sort: { dueAt: 'asc' },
      populate: ['course'],
    });
    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);
    const submissions = assignmentIds.length
      ? await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
          filters: { assignment: { id: { $in: assignmentIds } } },
          populate: ['user', 'assignment'],
          sort: { submittedAt: 'desc' },
        })
      : [];
    const userIds = [...new Set(submissions.map((submission) => Number(submission.user?.id)).filter(Boolean))];
    const profilesByUserId = await getProfilesByUserIds(strapi, userIds);

    ctx.send({
      data: assignments.map((assignment) => ({
        ...assignment,
        submissions: submissions
          .filter((submission) => Number(submission.assignment?.id || submission.assignment) === Number(assignment.id))
          .map((submission) => serializeSubmission(submission, profilesByUserId)),
      })),
    });
  },
}));