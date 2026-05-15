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

async function attachEnrollmentsToMembers(strapi, members) {
	const userIds = members
		.map((member) => Number(member?.user?.id))
		.filter(Boolean);

	if (userIds.length === 0) return members;

	const enrollments = await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
		filters: { user: { id: { $in: userIds } } },
		populate: ['course', 'user'],
		sort: { enrolledAt: 'desc' },
	});

	const enrollmentsByUserId = enrollments.reduce((acc, enrollment) => {
		const userId = Number(enrollment?.user?.id || enrollment?.user);
		if (!userId) return acc;
		if (!acc[userId]) acc[userId] = [];
		acc[userId].push(enrollment);
		return acc;
	}, {});

	return members.map((member) => {
		const userId = Number(member?.user?.id);
		if (!userId) return member;
		return {
			...member,
			user: {
				...member.user,
				enrollments: enrollmentsByUserId[userId] || [],
			},
		};
	});
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
					populate: {
						user: true,
					}
				},
			},
		});

		const membersWithEnrollments = await attachEnrollmentsToMembers(strapi, Array.isArray(cluster?.members) ? cluster.members : []);

		const members = membersWithEnrollments
			.filter(m => m.role !== 'cluster');

		ctx.send({
			cluster: {
				...cluster,
				members: membersWithEnrollments,
			},
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
