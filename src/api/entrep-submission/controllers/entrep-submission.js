'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { createNotification } = require('../../../utils/entrep-notifications');

async function resolveUser(strapi, ctx) {
	if (ctx.state.user?.id) {
		return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
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

function isAdminUser(user, profile) {
	return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
}

async function getManagedCourseIds(strapi, user, profile) {
	if (!profile && !isAdminUser(user, profile)) return [];
	if (isAdminUser(user, profile)) {
		const courses = await strapi.entityService.findMany('api::entrep-course.entrep-course', { fields: ['id'] });
		return courses.map((course) => Number(course.id)).filter(Boolean);
	}
	const courses = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
		filters: { trainer: profile.id },
		fields: ['id'],
	});
	return courses.map((course) => Number(course.id)).filter(Boolean);
}

async function getProfilesByUserIds(strapi, userIds) {
	if (!userIds.length) return new Map();
	const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
		filters: { user: { id: { $in: userIds } } },
		populate: ['user'],
	});
	return new Map(profiles.map((profile) => [Number(profile.user?.id), profile]));
}

function getDisplayName(user, profile, fallback = 'Learner') {
	return profile?.fullName || user?.fullName || user?.username || user?.email || fallback;
}

function serializeQuestion(question, profilesByUserId = new Map()) {
	const learnerUserId = Number(question.user?.id || question.user || 0);
	const learnerProfile = profilesByUserId.get(learnerUserId);
	return {
		...question,
		learnerName: getDisplayName(question.user, learnerProfile, 'Learner'),
		learnerPhotoUrl: learnerProfile?.profilePhotoUrl || '',
		courseTitle: question.course?.title || question.lesson?.module?.course?.title || 'Course',
		lessonTitle: question.lesson?.title || 'Lesson',
	};
}

module.exports = createCoreController('api::entrep-submission.entrep-submission', ({ strapi }) => ({
	async askLessonQuestion(ctx) {
		const user = await resolveUser(strapi, ctx);
		if (!user) return ctx.unauthorized();

		const lesson = await strapi.entityService.findOne('api::entrep-lesson.entrep-lesson', ctx.params.id, {
			populate: {
				module: {
					populate: {
						course: {
							populate: { trainer: { populate: ['user'] } },
						},
					},
				},
			},
		});
		if (!lesson?.module?.course) return ctx.notFound('Lesson not found');

		const enrollment = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
			filters: { user: user.id, course: lesson.module.course.id },
			limit: 1,
		});
		if (!enrollment?.[0]) return ctx.forbidden('Enroll in this course before asking a lesson question');

		const body = ctx.request.body || {};
		if (!String(body.textResponse || '').trim() && !body.mediaUrl) {
			return ctx.badRequest('Add a question or upload a file before sending');
		}

		const submission = await strapi.entityService.create('api::entrep-submission.entrep-submission', {
			data: {
				user: user.id,
				course: lesson.module.course.id,
				lesson: lesson.id,
				assignment: null,
				submissionType: body.submissionType || (body.mediaUrl ? 'document' : 'text'),
				mediaUrl: body.mediaUrl || null,
				fileName: body.fileName || null,
				textResponse: String(body.textResponse || '').trim() || null,
				trainerMediaUrl: null,
				trainerFileName: null,
				submittedAt: new Date().toISOString(),
				status: 'submitted',
			},
			populate: {
				user: true,
				course: true,
				lesson: { populate: { module: { populate: ['course'] } } },
			},
		});

		const profile = await getProfile(strapi, user.id);
		const trainerUserId = Number(lesson.module.course?.trainer?.user?.id || lesson.module.course?.trainer?.user || 0);
		if (trainerUserId) {
			await createNotification(strapi, {
				recipientId: trainerUserId,
				actorId: user.id,
				type: 'lesson_question',
				title: `New lesson question in ${lesson.module.course.title}`,
				message: `${getDisplayName(user, profile)} asked for help on ${lesson.title}.`,
				actionUrl: '/entrepreneur/trainer/dashboard',
				metadata: {
					questionId: submission.id,
					courseId: lesson.module.course.id,
					lessonId: lesson.id,
				},
			});
		}

		const profilesByUserId = await getProfilesByUserIds(strapi, [user.id]);
		ctx.send({ data: serializeQuestion(submission, profilesByUserId) });
	},

	async myLessonQuestions(ctx) {
		const user = await resolveUser(strapi, ctx);
		if (!user) return ctx.unauthorized();

		const list = await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
			filters: {
				user: user.id,
				lesson: { id: { $notNull: true } },
			},
			sort: { submittedAt: 'desc' },
			populate: {
				user: true,
				course: true,
				lesson: { populate: { module: { populate: ['course'] } } },
			},
		});
		const profilesByUserId = await getProfilesByUserIds(strapi, [user.id]);
		ctx.send({ data: list.map((item) => serializeQuestion(item, profilesByUserId)) });
	},

	async trainerLessonQuestions(ctx) {
		const user = await resolveUser(strapi, ctx);
		if (!user) return ctx.unauthorized();

		const profile = await getProfile(strapi, user.id);
		const managedCourseIds = await getManagedCourseIds(strapi, user, profile);
		if (!managedCourseIds.length) return ctx.send({ data: [] });

		const list = await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
			filters: {
				course: { id: { $in: managedCourseIds } },
				lesson: { id: { $notNull: true } },
			},
			sort: { submittedAt: 'desc' },
			populate: {
				user: true,
				course: true,
				lesson: { populate: { module: { populate: ['course'] } } },
			},
		});
		const userIds = [...new Set(list.map((item) => Number(item.user?.id || item.user)).filter(Boolean))];
		const profilesByUserId = await getProfilesByUserIds(strapi, userIds);
		ctx.send({ data: list.map((item) => serializeQuestion(item, profilesByUserId)) });
	},

	async respondToLessonQuestion(ctx) {
		const user = await resolveUser(strapi, ctx);
		if (!user) return ctx.unauthorized();

		const profile = await getProfile(strapi, user.id);
		const question = await strapi.entityService.findOne('api::entrep-submission.entrep-submission', ctx.params.id, {
			populate: {
				user: true,
				course: true,
				lesson: { populate: { module: { populate: { course: { populate: ['trainer'] } } } } },
			},
		});
		if (!question?.lesson) return ctx.notFound('Lesson question not found');

		const courseId = Number(question.course?.id || question.lesson?.module?.course?.id || question.course);
		const managedCourseIds = await getManagedCourseIds(strapi, user, profile);
		if (!managedCourseIds.includes(courseId)) {
			return ctx.forbidden('You can only answer questions for your own course');
		}

		const body = ctx.request.body || {};
		if (!String(body.feedback || '').trim() && !body.trainerMediaUrl) {
			return ctx.badRequest('Add a written response or upload a file before replying');
		}

		const updated = await strapi.entityService.update('api::entrep-submission.entrep-submission', question.id, {
			data: {
				feedback: String(body.feedback || '').trim() || null,
				trainerMediaUrl: body.trainerMediaUrl || null,
				trainerFileName: body.trainerFileName || null,
				gradedAt: new Date().toISOString(),
				status: 'approved',
			},
			populate: {
				user: true,
				course: true,
				lesson: { populate: { module: { populate: ['course'] } } },
			},
		});

		await createNotification(strapi, {
			recipientId: Number(question.user?.id || question.user),
			actorId: user.id,
			type: 'lesson_question',
			title: `Trainer response for ${updated.lesson?.title || 'your lesson question'}`,
			message: `Your trainer replied to your lesson question in ${updated.course?.title || 'your course'}.`,
			actionUrl: '/entrepreneur/dashboard',
			metadata: {
				questionId: updated.id,
				courseId,
				lessonId: updated.lesson?.id || null,
			},
		});

		const profilesByUserId = await getProfilesByUserIds(strapi, [Number(question.user?.id || question.user)].filter(Boolean));
		ctx.send({ data: serializeQuestion(updated, profilesByUserId) });
	},
}));
