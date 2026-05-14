'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId }, limit: 1,
  });
  return list?.[0] || null;
}

module.exports = createCoreController('api::entrep-course.entrep-course', ({ strapi }) => ({
  /**
   * Default `find` enriched to deep-populate modules & lessons for the catalog.
   */
  async find(ctx) {
    const params = ctx.query;
    const filters = { ...(params.filters || {}) };
    // Default to approved unless explicitly overridden (e.g. for trainer dashboard)
    if (!filters.status) filters.status = 'approved';

    const list = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
      filters,
      sort: params.sort || { createdAt: 'desc' },
      populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
    });
    ctx.send({ data: list });
  },

  async findOne(ctx) {
    const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', ctx.params.id, {
      populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
    });
    if (!course) return ctx.notFound();
    ctx.send({ data: course });
  },

  /**
   * POST /entrep/courses (trainer authoring)
   * Body: course fields + { modules: [{ title, description, lessons: [...], quiz: {...} }] }
   */
  async authorCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    if (!profile || !['trainer', 'admin', 'provider'].includes(profile.role)) {
      return ctx.forbidden('Only trainers or admins can author courses');
    }

    const b = ctx.request.body || {};
    if (!b.title) return ctx.badRequest('title is required');

    const course = await strapi.entityService.create('api::entrep-course.entrep-course', {
      data: {
        title: b.title,
        description: b.description,
        category: b.category,
        level: b.level || 'Beginner',
        skills: b.skills || [],
        durationWeeks: b.durationWeeks || 0,
        coverUrl: b.coverUrl,
        coverGradient: b.coverGradient,
        accent: b.accent,
        priceUGX: b.priceUGX || 0,
        passMark: b.passMark || 80,
        providerName: b.providerName || profile.fullName,
        trainer: profile.id,
        status: profile.role === 'admin' ? 'approved' : 'pending_review',
      },
    });

    // Modules + lessons + quiz
    if (Array.isArray(b.modules)) {
      for (let mi = 0; mi < b.modules.length; mi++) {
        const m = b.modules[mi];
        let quizEntity = null;
        if (m.quiz && Array.isArray(m.quiz.questions) && m.quiz.questions.length) {
          quizEntity = await strapi.entityService.create('api::entrep-quiz.entrep-quiz', {
            data: {
              title: m.quiz.title || `${m.title} quiz`,
              instructions: m.quiz.instructions,
              passMark: m.quiz.passMark || b.passMark || 80,
              maxAttempts: m.quiz.maxAttempts || 3,
              timeLimitMinutes: m.quiz.timeLimitMinutes || 0,
              questions: m.quiz.questions.map((q, i) => ({ id: q.id || `q${mi}_${i}`, ...q })),
              course: course.id,
            },
          });
        }
        const moduleEntity = await strapi.entityService.create('api::entrep-module.entrep-module', {
          data: {
            title: m.title,
            description: m.description,
            order: mi,
            course: course.id,
            quiz: quizEntity?.id || null,
          },
        });
        if (Array.isArray(m.lessons)) {
          for (let li = 0; li < m.lessons.length; li++) {
            const l = m.lessons[li];
            await strapi.entityService.create('api::entrep-lesson.entrep-lesson', {
              data: {
                title: l.title,
                description: l.description,
                order: li,
                lessonType: l.lessonType || 'video',
                videoUrl: l.videoUrl,
                pdfUrl: l.pdfUrl,
                imageUrl: l.imageUrl,
                bodyText: l.bodyText,
                durationMin: l.durationMin || 0,
                module: moduleEntity.id,
              },
            });
          }
        }
      }
    }

    const populated = await strapi.entityService.findOne('api::entrep-course.entrep-course', course.id, {
      populate: { modules: { populate: ['lessons', 'quiz'] } },
    });
    ctx.send({ course: populated });
  },

  /**
   * GET /entrep/me/courses – courses authored by the current trainer.
   */
  async myAuthoredCourses(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    if (!profile) return ctx.send({ data: [] });
    const list = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
      filters: { trainer: profile.id },
      populate: { modules: { populate: ['lessons', 'quiz'] } },
      sort: { createdAt: 'desc' },
    });
    ctx.send({ data: list });
  },

  /**
   * PATCH /entrep/courses/:id/approve – admin approval
   */
  async approveCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    const isAdmin = user.role?.type === 'admin' || profile?.role === 'admin';
    if (!isAdmin) return ctx.forbidden('Admin only');
    const { status = 'approved', feedback } = ctx.request.body || {};
    const updated = await strapi.entityService.update('api::entrep-course.entrep-course', ctx.params.id, {
      data: { status, rejectionFeedback: feedback || null },
    });
    ctx.send({ course: updated });
  },
}));
