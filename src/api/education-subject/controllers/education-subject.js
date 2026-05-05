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

function resolveIsActive(query = {}) {
	if (query?.filters?.isActive?.$eq === 'false' || query?.filters?.isActive?.$eq === false) {
		return false;
	}

	return true;
}

function sanitizeSubjectInput(body = {}) {
	const name = String(body.name || '').trim();
	const educationLevel = EDUCATION_LEVEL_OPTIONS.includes(body.educationLevel) ? body.educationLevel : null;
	const educationLevelOther = String(body.educationLevelOther || '').trim();
	const description = String(body.description || '').trim();
	const sortOrder = Number.parseInt(body.sortOrder, 10) || 0;
	const isActive = body.isActive !== false;

	if (!name) throw new Error('Subject name is required');
	if (!educationLevel) throw new Error('Education level is required');
	if (educationLevel === 'Other' && !educationLevelOther) {
		throw new Error('Provide the custom education level when selecting Other');
	}

	return {
		name,
		educationLevel,
		educationLevelOther: educationLevel === 'Other' ? educationLevelOther : null,
		description: description || null,
		sortOrder,
		isActive,
	};
}

module.exports = createCoreController('api::education-subject.education-subject', ({ strapi }) => ({
	async find(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		const allowInactive = isAdminUser(requester) && String(ctx.query?.includeInactive || '') === 'true';

		const materials = await strapi.documents('api::education-subject.education-subject').findMany({
			filters: {
				...(!allowInactive ? { isActive: resolveIsActive(ctx.query) } : {}),
				...(resolveEducationLevel(ctx.query) ? { educationLevel: resolveEducationLevel(ctx.query) } : {}),
			},
			sort: ['sortOrder:asc', 'name:asc'],
		});

		ctx.body = { data: materials };
	},

	async findOne(ctx) {
		const subject = await strapi.documents('api::education-subject.education-subject').findOne({
			documentId: ctx.params.id,
		});

		if (!subject) return ctx.notFound('Education subject not found');
		ctx.body = { data: subject };
	},

	async create(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education subjects');

		try {
			const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
			const created = await strapi.documents('api::education-subject.education-subject').create({
				data: sanitizeSubjectInput(body),
			});
			ctx.body = { data: created };
		} catch (error) {
			return ctx.badRequest(error.message || 'Failed to create education subject');
		}
	},

	async update(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education subjects');

		const existing = await strapi.documents('api::education-subject.education-subject').findOne({
			documentId: ctx.params.id,
		});
		if (!existing) return ctx.notFound('Education subject not found');

		try {
			const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
			const updated = await strapi.documents('api::education-subject.education-subject').update({
				documentId: ctx.params.id,
				data: sanitizeSubjectInput({ ...existing, ...body }),
			});
			ctx.body = { data: updated };
		} catch (error) {
			return ctx.badRequest(error.message || 'Failed to update education subject');
		}
	},

	async delete(ctx) {
		const requester = await getRequesterWithRole(strapi, ctx.state.user?.id);
		if (!isAdminUser(requester)) return ctx.forbidden('Only admins can manage education subjects');

		const existing = await strapi.documents('api::education-subject.education-subject').findOne({
			documentId: ctx.params.id,
		});
		if (!existing) return ctx.notFound('Education subject not found');

		await strapi.documents('api::education-subject.education-subject').delete({
			documentId: ctx.params.id,
		});
		ctx.body = { data: { documentId: ctx.params.id, deleted: true } };
	},
}));