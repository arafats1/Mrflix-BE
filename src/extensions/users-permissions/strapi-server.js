'use strict';

const bcrypt = require('bcryptjs');

/**
 * Extend the users-permissions plugin:
 * - Include role in /users/me response
 * - Override Google provider to use full name as username
 */
// Religion options must match the dropdown used on registration AND
// religion-content tagging in the admin panel so filtering stays uniform.
const RELIGION_OPTIONS = [
  'Catholic',
  'Protestant',
  'Pentecostal',
  'Adventist',
  'Orthodox',
  'Muslim',
  'Hindu',
  'Bahai',
  'Traditional',
  'Other',
];

module.exports = (plugin) => {
  plugin.contentTypes.user.schema.attributes.isKeypUser = {
    type: 'boolean',
    default: false,
  };

  plugin.contentTypes.user.schema.attributes.keypActivatedAt = {
    type: 'datetime',
  };

  // Parent-account fields. A "parent" account can create child profiles
  // and gets parental-control features (watch-time limits, content blocks).
  plugin.contentTypes.user.schema.attributes.phone = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.religion = {
    type: 'enumeration',
    enum: RELIGION_OPTIONS,
  };

  plugin.contentTypes.user.schema.attributes.isParent = {
    type: 'boolean',
    default: false,
  };

  plugin.contentTypes.user.schema.attributes.parentPinHash = {
    type: 'password',
    private: true,
  };

  plugin.contentTypes.user.schema.attributes.parentPinUpdatedAt = {
    type: 'datetime',
  };

  // Child profiles created by this parent account.
  plugin.contentTypes.user.schema.attributes.childProfiles = {
    type: 'relation',
    relation: 'oneToMany',
    target: 'api::child-profile.child-profile',
    mappedBy: 'parent',
  };

  // Override the me controller to populate role
  const originalMe = plugin.controllers.user.me;

  plugin.controllers.user.me = async (ctx) => {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized();
    }

    const isKeypClient = ['true', '1', 'web', 'mrkeyp'].includes(String(ctx.request.header['x-mrkeyp-client'] || '').toLowerCase());

    let userWithRole = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({
        where: { id: user.id },
        populate: ['role', 'childProfiles'],
      });

    if (!userWithRole) {
      return ctx.unauthorized();
    }

    if (isKeypClient && !userWithRole.isKeypUser) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          isKeypUser: true,
          keypActivatedAt: new Date().toISOString(),
        },
      });

      userWithRole = {
        ...userWithRole,
        isKeypUser: true,
        keypActivatedAt: new Date().toISOString(),
      };
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
      phone: userWithRole.phone || null,
      religion: userWithRole.religion || null,
      isParent: !!userWithRole.isParent,
      hasParentPin: !!userWithRole.parentPinHash,
      parentPinUpdatedAt: userWithRole.parentPinUpdatedAt || null,
      childProfiles: Array.isArray(userWithRole.childProfiles)
        ? userWithRole.childProfiles.map((c) => ({
            id: c.id,
            documentId: c.documentId,
            name: c.name,
            dateOfBirth: c.dateOfBirth,
            avatarUrl: c.avatarUrl,
            dailyWatchMinutes: c.dailyWatchMinutes,
            blockedMovieIds: Array.isArray(c.blockedMovieIds) ? c.blockedMovieIds : [],
          }))
        : [],
      isKeypUser: !!userWithRole.isKeypUser,
      keypActivatedAt: userWithRole.keypActivatedAt,
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

  // Wrap the register controller so we can persist parent-account fields
  // (phone, religion, isParent, fullName) that the default users-permissions
  // register strips out. We let the original handler create the user, then
  // patch the new record with our extras and re-issue the response.
  const originalRegister = plugin.controllers.auth.register;

  plugin.controllers.auth.register = async (ctx) => {
    const body = ctx.request.body || {};
    const extras = {
      fullName: typeof body.fullName === 'string' ? body.fullName.trim() : undefined,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      religion: RELIGION_OPTIONS.includes(body.religion) ? body.religion : undefined,
      isParent: body.isParent === true || body.isParent === 'true',
    };

    // Strapi v5's users-permissions register validator rejects unknown keys
    // (e.g. religion, isParent, phone, fullName) before reaching our wrapper,
    // so we strip them off the request body, let the core handler run with
    // only the canonical { username, email, password }, then patch the new
    // user with our extras afterwards.
    ctx.request.body = {
      username: body.username,
      email: body.email,
      password: body.password,
    };

    await originalRegister(ctx);

    // If registration failed the body will be an error — bail out.
    const created = ctx.body && ctx.body.user;
    if (!created || !created.id) return;

    const updateData = {};
    if (extras.fullName) updateData.fullName = extras.fullName;
    if (extras.phone) updateData.phone = extras.phone;
    if (extras.religion) updateData.religion = extras.religion;
    if (extras.isParent) updateData.isParent = true;

    if (Object.keys(updateData).length > 0) {
      try {
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: created.id },
          data: updateData,
        });
        ctx.body = {
          ...ctx.body,
          user: { ...created, ...updateData },
        };
      } catch (err) {
        strapi.log.warn(`[register-extension] failed to persist parent fields: ${err.message}`);
      }
    }
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
