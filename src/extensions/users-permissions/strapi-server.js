'use strict';

const bcrypt = require('bcryptjs');
const utils = require('@strapi/utils');

const { ValidationError } = utils.errors;

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

function normalizePhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  if (!raw) return '';

  let normalized = raw.replace(/[\s()+-]/g, '');
  if (normalized.startsWith('0')) normalized = `256${normalized.slice(1)}`;
  return normalized;
}

function looksLikePhone(identifier) {
  const normalized = normalizePhone(identifier);
  return /^\d{9,15}$/.test(normalized);
}

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
    unique: true,
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

  // Override the me controller to populate role.
  // `plugin.controllers.user` is a plain object (not a factory), so direct
  // property assignment is the correct override pattern here.
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

  // Wrap the auth controller factory so our overrides actually take effect.
  // In Strapi v5, `plugin.controllers.auth` is a factory `({ strapi }) => ({ ...actions })`,
  // so assigning to `.callback`/`.register` on the factory itself is silently ignored.
  // We replace the factory with one that calls the original, then layers our wrappers
  // on top of the resolved action object.
  const originalAuthFactory = plugin.controllers.auth;

  plugin.controllers.auth = (context) => {
    const original = originalAuthFactory(context);
    const originalCallback = original.callback.bind(original);
    const originalRegister = original.register.bind(original);

    return {
      ...original,

      async callback(ctx) {
        const provider = ctx.params.provider || 'local';

        if (provider === 'local') {
          const identifier = typeof ctx.request.body?.identifier === 'string'
            ? ctx.request.body.identifier.trim()
            : '';

          if (identifier && looksLikePhone(identifier)) {
            const normalizedIdentifier = normalizePhone(identifier);
            const users = await strapi.db.query('plugin::users-permissions.user').findMany({
              where: { provider: 'local' },
              select: ['id', 'email', 'username', 'phone'],
              limit: 20000,
            });

            const matchedUser = users.find(
              (entry) => normalizePhone(entry.phone) === normalizedIdentifier
            );

            if (matchedUser) {
              ctx.request.body.identifier = matchedUser.email || matchedUser.username;
            }
          }
        }

        return originalCallback(ctx);
      },

      async register(ctx) {
        const body = ctx.request.body || {};
        const normalizedPhone = normalizePhone(body.phone);
        const isParent = body.isParent === true || body.isParent === 'true';

        if (!isParent) {
          throw new ValidationError('You must confirm that you are a parent to register');
        }

        const extras = {
          fullName: typeof body.fullName === 'string' ? body.fullName.trim() : undefined,
          phone: normalizedPhone || undefined,
          religion: RELIGION_OPTIONS.includes(body.religion) ? body.religion : undefined,
          isParent,
        };

        if (normalizedPhone) {
          const existingUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: { phone: { $notNull: true } },
            select: ['id', 'phone'],
            limit: 20000,
          });

          const duplicatePhone = existingUsers.find(
            (entry) => normalizePhone(entry.phone) === normalizedPhone
          );
          if (duplicatePhone) {
            throw new ValidationError('Phone number is already in use');
          }
        }

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
      },
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
