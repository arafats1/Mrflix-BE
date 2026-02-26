'use strict';

/**
 * Extend the users-permissions plugin to include role in /users/me response
 */
module.exports = (plugin) => {
  // Override the me controller to populate role
  const originalMe = plugin.controllers.user.me;

  plugin.controllers.user.me = async (ctx) => {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized();
    }

    // Fetch user with role populated
    const userWithRole = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({
        where: { id: user.id },
        populate: ['role'],
      });

    if (!userWithRole) {
      return ctx.unauthorized();
    }

    // Return user data with role
    ctx.body = {
      id: userWithRole.id,
      documentId: userWithRole.documentId,
      username: userWithRole.username,
      email: userWithRole.email,
      provider: userWithRole.provider,
      confirmed: userWithRole.confirmed,
      blocked: userWithRole.blocked,
      fullName: userWithRole.fullName,
      createdAt: userWithRole.createdAt,
      updatedAt: userWithRole.updatedAt,
      role: userWithRole.role
        ? {
            id: userWithRole.role.id,
            documentId: userWithRole.role.documentId,
            name: userWithRole.role.name,
            type: userWithRole.role.type,
          }
        : null,
    };
  };

  return plugin;
};
