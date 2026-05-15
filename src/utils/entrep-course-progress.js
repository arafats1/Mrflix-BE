'use strict';

function genCertNumber(courseId, userId) {
  const stamp = Date.now().toString(36).toUpperCase();
  return `MOVO-ENT-${courseId}-${userId}-${stamp}`;
}

async function getCoursePopulated(strapi, courseId) {
  return strapi.entityService.findOne('api::entrep-course.entrep-course', courseId, {
    populate: {
      modules: {
        populate: ['lessons', 'quiz'],
      },
    },
  });
}

function computeProgressAndScore(course, completedLessons, moduleQuizResults, lessonProgress = {}, assignmentResults = {}) {
  const totalLessons = (course.modules || []).reduce((acc, module) => acc + (module.lessons?.length || 0), 0);
  let summedLessonProgress = 0;
  for (const module of course.modules || []) {
    for (const lesson of module.lessons || []) {
      const entry = lessonProgress[String(lesson.id)] || null;
      if (entry?.completed) {
        summedLessonProgress += 100;
        continue;
      }
      summedLessonProgress += Math.max(0, Math.min(100, Number(entry?.progressPct) || 0));
    }
  }

  const progressPct = totalLessons > 0 ? Math.round(summedLessonProgress / totalLessons) : 0;
  const quizScores = Object.values(moduleQuizResults || {}).map((result) => Number(result?.percentage) || 0);
  const assignmentScores = Object.values(assignmentResults || {})
    .filter((result) => result?.graded)
    .map((result) => Number(result?.percentage) || 0);
  const scoreParts = [...quizScores, ...assignmentScores];
  const overallScore = scoreParts.length
    ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length)
    : 0;

  return { progressPct, overallScore };
}

async function issueCertificate(strapi, { course, userId, overallScore }) {
  const certNumber = genCertNumber(course.id, userId);
  const profile = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
  });
  const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId);

  return strapi.entityService.create('api::entrep-certificate.entrep-certificate', {
    data: {
      certificateNumber: certNumber,
      user: userId,
      course: course.id,
      learnerName: profile?.[0]?.fullName || user?.username || user?.email || 'Learner',
      courseTitle: course.title,
      finalScore: overallScore,
      issuedAt: new Date().toISOString(),
    },
  });
}

async function syncEnrollmentMetricsAndCertificate(strapi, {
  enrollment,
  course,
  userId,
  completedLessons,
  lessonProgress,
  moduleQuizResults,
  assignmentResults,
}) {
  const normalizedCompletedLessons = Array.isArray(completedLessons) ? completedLessons : [];
  const normalizedLessonProgress = lessonProgress && typeof lessonProgress === 'object' ? lessonProgress : {};
  const normalizedModuleQuizResults = moduleQuizResults && typeof moduleQuizResults === 'object' ? moduleQuizResults : {};
  const normalizedAssignmentResults = assignmentResults && typeof assignmentResults === 'object' ? assignmentResults : {};
  const { progressPct, overallScore } = computeProgressAndScore(
    course,
    normalizedCompletedLessons,
    normalizedModuleQuizResults,
    normalizedLessonProgress,
    normalizedAssignmentResults
  );

  const coursePassMark = Number(course.passMark || 80);
  const allModuleQuizzes = (course.modules || []).filter((module) => module.quiz?.id);
  const allModulesPassed = allModuleQuizzes.every((module) => {
    const result = normalizedModuleQuizResults[String(module.id)];
    return result && result.passed;
  });

  const assignments = await strapi.entityService.findMany('api::entrep-assignment.entrep-assignment', {
    filters: { course: course.id },
    fields: ['id'],
  });
  const allAssignmentsGraded = assignments.every((assignment) => {
    const result = normalizedAssignmentResults[String(assignment.id)];
    return result && result.graded;
  });

  const updateData = {
    completedLessons: normalizedCompletedLessons,
    lessonProgress: normalizedLessonProgress,
    moduleQuizResults: normalizedModuleQuizResults,
    assignmentResults: normalizedAssignmentResults,
    progressPct,
    overallScore,
  };

  let certificate = null;
  const eligibleForCertificate = progressPct >= 100 && overallScore >= coursePassMark && allModulesPassed && allAssignmentsGraded;

  if (eligibleForCertificate && !enrollment.certificateIssued) {
    certificate = await issueCertificate(strapi, { course, userId, overallScore });
    updateData.status = 'completed';
    updateData.completedAt = new Date().toISOString();
    updateData.certificateIssued = true;
  } else if (!enrollment.certificateIssued && enrollment.status !== 'dropped') {
    updateData.status = 'active';
  }

  const updatedEnrollment = await strapi.entityService.update('api::entrep-enrollment.entrep-enrollment', enrollment.id, {
    data: updateData,
  });

  return {
    enrollment: updatedEnrollment,
    certificate,
    progressPct,
    overallScore,
    allModulesPassed,
    allAssignmentsGraded,
  };
}

module.exports = {
  computeProgressAndScore,
  getCoursePopulated,
  syncEnrollmentMetricsAndCertificate,
};