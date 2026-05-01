'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::music.music', ({ strapi }) => ({
	async addComment(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized('Login required');

		const { id } = ctx.params;
		const { text } = ctx.request.body;
		if (!text?.trim()) return ctx.badRequest('Comment text is required');

		const track = await strapi.documents('api::music.music').findOne({ documentId: id });
		if (!track) return ctx.notFound('Track not found');

		const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
			where: { id: user.id },
		});

		const comments = Array.isArray(track.comments) ? [...track.comments] : [];
		comments.push({
			id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			userId: fullUser?.documentId || String(user.id),
			authorName: fullUser?.fullName || fullUser?.username || 'User',
			text: text.trim(),
			createdAt: new Date().toISOString(),
		});

		const updated = await strapi.documents('api::music.music').update({
			documentId: id,
			data: { comments },
		});

		return { comments: updated.comments };
	},
}));
