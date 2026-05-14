'use strict';
const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
	if (ctx.state.user?.id) {
		return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
	}
	return null;
}

async function findProfileForUser(strapi, userId) {
	const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
		filters: { user: userId },
		populate: ['cluster'],
		limit: 1,
	});
	return list?.[0] || null;
}

module.exports = createCoreController('api::entrep-cluster.entrep-cluster', ({ strapi }) => ({
	async myCluster(ctx) {
		const user = await resolveUser(strapi, ctx);
		if (!user) return ctx.unauthorized();

		const profile = await findProfileForUser(strapi, user.id);
		if (!profile?.cluster?.id) return ctx.notFound('Cluster not found');

		const cluster = await strapi.entityService.findOne('api::entrep-cluster.entrep-cluster', profile.cluster.id, {
			populate: {
				members: {
					fields: ['fullName', 'email', 'phone', 'role', 'approvalStatus', 'location', 'expertise', 'yearsOfExperience', 'createdAt'],
				},
			},
		});

		const members = Array.isArray(cluster?.members) ? cluster.members : [];
		ctx.send({
			cluster,
			members,
			summary: {
				totalMembers: members.length,
				learners: members.filter((member) => member.role === 'learner').length,
				trainers: members.filter((member) => member.role === 'trainer').length,
				providers: members.filter((member) => member.role === 'provider').length,
			},
		});
	},
}));
