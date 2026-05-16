'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getCoursePopulated, syncEnrollmentMetricsAndCertificate } = require('../../../utils/entrep-course-progress');

const LESSON_COMPLETION_THRESHOLD = 95;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function findOrCreateEnrollment(strapi, userId, courseId) {
  const list = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: { user: userId, course: courseId },
    limit: 1,
  });
  if (list?.[0]) return list[0];
  return strapi.entityService.create('api::entrep-enrollment.entrep-enrollment', {
    data: {
      user: userId,
      course: courseId,
      enrolledAt: new Date().toISOString(),
      status: 'active',
      completedLessons: [],
      lessonProgress: {},
      moduleQuizResults: {},
      assignmentResults: {},
      progressPct: 0,
      overallScore: 0,
    },
  });
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function positiveNumberOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function findLessonInCourse(course, lessonId) {
  const key = String(lessonId);
  for (const module of course.modules || []) {
    for (const lesson of module.lessons || []) {
      if (String(lesson.id) === key) {
        return { module, lesson };
      }
    }
  }
  return null;
}

module.exports = createCoreController('api::entrep-enrollment.entrep-enrollment', ({ strapi }) => ({
  /**
   * GET /entrep/me/enrollments  – enrollments for the current user.
   */
  async myEnrollments(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const list = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
      filters: { user: user.id },
      populate: {
        course: {
          populate: {
            modules: {
              populate: ['lessons'],
            },
          },
        },
      },
      sort: { enrolledAt: 'desc' },
    });
    ctx.send({ data: list });
  },

  /**
   * POST /entrep/courses/:id/enroll
   */
  async enroll(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const courseId = Number(ctx.params.id);
    const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', courseId);
    if (!course) return ctx.notFound('Course not found');
    const enrollment = await findOrCreateEnrollment(strapi, user.id, courseId);
    ctx.send({ enrollment });
  },

  /**
   * POST /entrep/courses/:id/progress
   * Body: { lessonId, progressPct?, lastPositionSec?, durationSec?, lastPage?, totalPages?, isCompleted? }
   * Stores lesson progress/resume state and marks a lesson complete at the threshold.
   */
  async markLessonComplete(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const courseId = Number(ctx.params.id);
    const { lessonId } = ctx.request.body || {};
    if (!lessonId) return ctx.badRequest('lessonId is required');

    const enrollment = await findOrCreateEnrollment(strapi, user.id, courseId);
    const course = await getCoursePopulated(strapi, courseId);
    if (!course) return ctx.notFound('Course not found');

    const match = findLessonInCourse(course, lessonId);
    if (!match) return ctx.badRequest('Lesson not found in this course');

    const {
      progressPct,
      lastPositionSec,
      durationSec,
      lastPage,
      totalPages,
      isCompleted,
    } = ctx.request.body || {};

    const completed = Array.isArray(enrollment.completedLessons) ? [...enrollment.completedLessons] : [];
    const lessonProgress = enrollment.lessonProgress && typeof enrollment.lessonProgress === 'object'
      ? { ...enrollment.lessonProgress }
      : {};
    const idStr = String(lessonId);
    const previous = lessonProgress[idStr] && typeof lessonProgress[idStr] === 'object'
      ? lessonProgress[idStr]
      : {};

    let nextProgressPct = clampPercent(progressPct);
    const nextDurationSec = positiveNumberOrNull(durationSec) ?? positiveNumberOrNull(previous.durationSec);
    const nextPositionSec = positiveNumberOrNull(lastPositionSec);
    const nextLastPage = positiveNumberOrNull(lastPage);
    const nextTotalPages = positiveNumberOrNull(totalPages) ?? positiveNumberOrNull(previous.totalPages);

    if (nextProgressPct == null && nextDurationSec && nextPositionSec != null && nextDurationSec > 0) {
      nextProgressPct = clampPercent((nextPositionSec / nextDurationSec) * 100);
    }

    if (nextProgressPct == null && nextLastPage != null && nextTotalPages && nextTotalPages > 0) {
      nextProgressPct = clampPercent((nextLastPage / nextTotalPages) * 100);
    }

    nextProgressPct = Math.max(nextProgressPct ?? 0, clampPercent(previous.progressPct) ?? 0);
    if (isCompleted === true) nextProgressPct = 100;

    const reachedCompletionThreshold = nextProgressPct >= LESSON_COMPLETION_THRESHOLD || previous.completed === true;
    if (reachedCompletionThreshold && !completed.includes(idStr)) completed.push(idStr);

    lessonProgress[idStr] = {
      ...previous,
      lessonType: match.lesson.lessonType || previous.lessonType || 'video',
      moduleId: match.module?.id || previous.moduleId || null,
      progressPct: nextProgressPct,
      lastPositionSec: nextPositionSec != null ? nextPositionSec : (previous.lastPositionSec ?? null),
      durationSec: nextDurationSec ?? null,
      lastPage: nextLastPage != null ? nextLastPage : (previous.lastPage ?? null),
      totalPages: nextTotalPages ?? null,
      completed: reachedCompletionThreshold,
      updatedAt: new Date().toISOString(),
    };

    const syncResult = await syncEnrollmentMetricsAndCertificate(strapi, {
      enrollment,
      course,
      userId: user.id,
      completedLessons: completed,
      lessonProgress,
      moduleQuizResults: enrollment.moduleQuizResults,
      assignmentResults: enrollment.assignmentResults,
    });
    const updated = syncResult.enrollment;

    ctx.send({ enrollment: updated, lessonProgress: lessonProgress[idStr] });
  },

  /**
   * POST /entrep/courses/:id/quiz/:quizId/submit
   * Body: { answers: { [questionId]: optionIndex|text }, moduleId }
   * Auto-grades MCQ questions, stores attempt, updates enrollment.moduleQuizResults.
   * If progress 100% AND overall >= passMark, issue certificate.
   */
  async submitQuiz(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const courseId = Number(ctx.params.id);
    const quizId = Number(ctx.params.quizId);
    const { answers = {}, moduleId } = ctx.request.body || {};

    const [course, quiz] = await Promise.all([
      getCoursePopulated(strapi, courseId),
      strapi.entityService.findOne('api::entrep-quiz.entrep-quiz', quizId),
    ]);
    if (!course || !quiz) return ctx.notFound();

    const enrollment = await findOrCreateEnrollment(strapi, user.id, courseId);
    const targetModule = (course.modules || []).find((module) => {
      if (moduleId && String(module.id) === String(moduleId)) return true;
      return Number(module.quiz?.id) === quizId;
    });
    if (!targetModule) return ctx.badRequest('Quiz module not found for this course');

    const completed = Array.isArray(enrollment.completedLessons) ? enrollment.completedLessons : [];
    const lockedLessons = (targetModule.lessons || []).filter((lesson) => !completed.includes(String(lesson.id)));
    if (lockedLessons.length > 0) {
      return ctx.badRequest(`Complete at least ${LESSON_COMPLETION_THRESHOLD}% of every lesson in this module before taking the quiz`);
    }

    // Grade MCQ + true/false. Unsupported types contribute 0 unless marked by trainer.
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    let earned = 0;
    let total = 0;
    const breakdown = [];
    for (const q of questions) {
      const pts = Number(q.points || 1);
      total += pts;
      const given = answers[q.id];
      let correct = false;
      if (q.type === 'multiple_choice' || q.type === 'true_false') {
        correct = String(given) === String(q.correctIndex ?? q.correctAnswer);
      } else if (q.type === 'short_answer' && q.correctAnswer) {
        correct = String(given || '').trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase();
      }
      if (correct) earned += pts;
      breakdown.push({ id: q.id, correct, given });
    }
    const percentage = total > 0 ? Math.round((earned / total) * 100) : 0;
    const passMark = Number(quiz.passMark || 80);
    const passed = percentage >= passMark;

    // Attempt number
    const prior = await strapi.entityService.findMany('api::entrep-quiz-attempt.entrep-quiz-attempt', {
      filters: { user: user.id, quiz: quizId },
    });
    const attemptNumber = (prior?.length || 0) + 1;

    await strapi.entityService.create('api::entrep-quiz-attempt.entrep-quiz-attempt', {
      data: {
        user: user.id,
        quiz: quizId,
        course: courseId,
        module: moduleId || null,
        answers: breakdown,
        score: earned,
        totalPoints: total,
        percentage,
        passed,
        attemptNumber,
        submittedAt: new Date().toISOString(),
      },
    });

    // Update enrollment
    const moduleQuizResults = { ...(enrollment.moduleQuizResults || {}) };
    const key = String(moduleId || quizId);
    const previous = moduleQuizResults[key];
    if (!previous || (previous.percentage || 0) < percentage) {
      moduleQuizResults[key] = { percentage, passed, attemptNumber, score: earned, totalPoints: total, at: new Date().toISOString() };
    }

    const syncResult = await syncEnrollmentMetricsAndCertificate(strapi, {
      enrollment,
      course,
      userId: user.id,
      completedLessons: completed,
      lessonProgress: enrollment.lessonProgress || {},
      moduleQuizResults,
      assignmentResults: enrollment.assignmentResults,
    });
    const updated = syncResult.enrollment;
    const issuedCertificate = syncResult.certificate;

    ctx.send({
      result: { earned, total, percentage, passed, passMark, breakdown },
      enrollment: updated,
      certificate: issuedCertificate,
    });
  },

  /**
   * GET /entrep/me/certificates
   */
  async myCertificates(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const list = await strapi.entityService.findMany('api::entrep-certificate.entrep-certificate', {
      filters: { user: user.id },
      populate: ['course'],
      sort: { issuedAt: 'desc' },
    });
    ctx.send({ data: list });
  },
}));
