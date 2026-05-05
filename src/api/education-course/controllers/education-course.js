'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const EDUCATION_LEVEL_OPTIONS = ['Kindergarten', 'Primary', 'Secondary', 'Technical college', 'University', 'Other'];

async function getRequesterWithRole(strapi, userId) {
	if (!userId) return null;
	return strapi.query('plugin::users-permissions.user').findOne({
		where: { id: userId },
		populate: ['role'],
	});
}

function isAdminUser(user) {
	return user?.role?.type === 'admin' || user?.role?.name === 'Admin';
}

function resolveEducationLevel(query = {}) {
	return query?.filters?.educationLevel?.$eq || query?.educationLevel || null;
}

function resolveSubjectId(query = {}) {
	return query?.filters?.subject?.id?.$eq || query?.subjectId || null;
}

function resolveIsActive(query = {}) {
	if (query?.filters?.isActive?.$eq === 'false' || query?.filters?.isActive?.$eq === false) {
		return false;
	}

	return true;
}

function sanitizeCourseInput(body = {}) {
	const title = String(body.title || '').trim();
	const educationLevel = EDUCATION_LEVEL_OPTIONS.includes(body.educationLevel) ? body.educationLevel : null;
	const educationLevelOther = String(body.educationLevelOther || '').trim();
	const description = String(body.description || '').trim();
	const sortOrder = Number.parseInt(body.sortOrder, 10) || 0;
	const isActive = body.isActive !== false;
	const subject = body.subject || null;

	if (!title) throw new Error('Course title is required');
	if (!educationLevel) throw new Error('Education level is required');
	if (educationLevel === 'Other' && !educationLevelOther) {
		throw new Error('Provide the custom education level when selecting Other');
	}
	if (!subject) throw new Error('Select a subject for this course');

	return {
		title,
		educationLevel,
		educationLevelOther: educationLevel === 'Other' ? educationLevelOther : null,
		description: description || null,
		sortOrder,
		isActive,
		subject,
	};
}

module.exports = createCoreController('api::education-course.education-course', ({ strapi }) => ({
	async find(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		const allowInactive = isAdminUser(requester) && String(ctx.query?.includeInactive || '') === 'true';

		const courses = await strapi.documents('api::education-course.education-course').findMany({
			filters: {
				...(!allowInactive ? { isActive: resolveIsActive(ctx.query) } : {}),
				...(resolveEducationLevel(ctx.query) ? { educationLevel: resolveEducationLevel(ctx.query) } : {}),
				...(resolveSubjectId(ctx.query) ? { subject: { documentId: String(resolveSubjectId(ctx.query)) } } : {}),
			},
			populate: {
				subject: true,
			},
			sort: ['sortOrder:asc', 'title:asc'],
		});

		ctx.body = { data: courses };
	},

	async findOne(ctx) {
		const course = await strapi.documents('api::education-course.education-course').findOne({
			documentId: ctx.params.id,
			populate: {
				subject: true,
			},
		});

		if (!course) return ctx.notFound('Education course not found');
		ctx.body = { data: course };
	},

	async create(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education courses');

		try {
			const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
			const created = await strapi.documents('api::education-course.education-course').create({
				data: sanitizeCourseInput(body),
				populate: { subject: true },
			});
			ctx.body = { data: created };
		} catch (error) {
			return ctx.badRequest(error.message || 'Failed to create education course');
		}
	},

	async update(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education courses');

		const existing = await strapi.documents('api::education-course.education-course').findOne({
			documentId: ctx.params.id,
			populate: { subject: true },
		});
		if (!existing) return ctx.notFound('Education course not found');

		try {
			const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
			const updated = await strapi.documents('api::education-course.education-course').update({
				documentId: ctx.params.id,
				data: sanitizeCourseInput({
					...existing,
					...body,
					subject: body.subject || existing.subject?.documentId || existing.subject?.id || null,
				}),
				populate: { subject: true },
			});
			ctx.body = { data: updated };
		} catch (error) {
			return ctx.badRequest(error.message || 'Failed to update education course');
		}
	},

	async delete(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education courses');

		const existing = await strapi.documents('api::education-course.education-course').findOne({
			documentId: ctx.params.id,
		});
		if (!existing) return ctx.notFound('Education course not found');

		await strapi.documents('api::education-course.education-course').delete({
			documentId: ctx.params.id,
		});
		ctx.body = { data: { documentId: ctx.params.id, deleted: true } };
	},
}));