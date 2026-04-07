'use strict';

/**
 * Extend the users-permissions plugin:
 * - Include role in /users/me response
 * - Override Google provider to use full name as username
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

    // Check for active subscription
    const now = new Date().toISOString();
    const [activeSub, activeExclSub] = await Promise.all([
      strapi.entityService.findMany('api::subscription.subscription', {
        filters: {
          subscriber: { id: user.id },
          status: 'active',
          endDate: { $gte: now },
        },
        limit: 1,
      }),
      strapi.entityService.findMany('api::exclusive-subscription.exclusive-subscription', {
        filters: {
          subscriber: { id: user.id },
          status: 'active',
          endDate: { $gte: now },
        },
        limit: 1,
      }),
    ]);

    // Return user data with role and premium status
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
      isPremium: activeSub && activeSub.length > 0,
      isExclusiveSubscribed: activeExclSub && activeExclSub.length > 0,
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

  // Override Google provider to use full name instead of email prefix as username
  const originalProviders = plugin.services.providers;

  plugin.services.providers = (context) => {
    const providers = originalProviders(context);
    const originalConnect = providers.connect.bind(providers);

    providers.connect = async (provider, query) => {
      if (provider === 'google') {
        const accessToken = query.access_token || query.code || query.oauth_token;
        if (accessToken) {
          try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const profile = await res.json();
            if (profile.name && profile.email) {
              // Store the name so we can set it after user creation
              query._googleName = profile.name;
              query._googleEmail = profile.email;
            }
          } catch (err) {
            // Continue with default flow
          }
        }

        // If a user already exists with the same email but registered via
        // email/password (provider = "local"), link the Google login to
        // that existing account so they can sign in with either method.
        if (query._googleEmail) {
          const existingLocal = await strapi.db
            .query('plugin::users-permissions.user')
            .findOne({ where: { email: query._googleEmail.toLowerCase() } });

          if (existingLocal && existingLocal.provider === 'local') {
            // Update their fullName from Google if they don't have one yet
            const updateData = {};
            if (!existingLocal.fullName && query._googleName) {
              updateData.fullName = query._googleName;
            }
            if (Object.keys(updateData).length > 0) {
              await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: existingLocal.id },
                data: updateData,
              });
              Object.assign(existingLocal, updateData);
            }
            return existingLocal;
          }
        }
      }

      const user = await originalConnect(provider, query);

      // Update username and fullName for new Google users
      if (provider === 'google' && query._googleName && user) {
        const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: user.id },
        });
        if (currentUser && (!currentUser.fullName || currentUser.username === currentUser.email?.split('@')[0])) {
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: user.id },
            data: {
              username: query._googleName,
              fullName: query._googleName,
            },
          });
          user.username = query._googleName;
          user.fullName = query._googleName;
        }
      }

      return user;
    };

    return providers;
  };

  return plugin;
};
