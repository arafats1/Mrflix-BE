'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const utils = require('@strapi/utils');
const { sendSms } = require('../../utils/sms');

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

const ACCOUNT_TYPE_OPTIONS = ['parent', 'provider', 'both'];
const PROVIDER_TYPE_OPTIONS = ['teacher', 'religious', 'seller', 'musician', 'creative_artist', 'comedian'];
const EDUCATION_LEVEL_OPTIONS = [
  'Kindergarten',
  'Primary',
  'Secondary',
  'Technical college',
  'University',
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

function normalizeProviderTypes(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? [input]
      : [];

  return [...new Set(values.filter((value) => PROVIDER_TYPE_OPTIONS.includes(value)))];
}

function userHasProviderAccess(user) {
  return user?.accountType === 'provider' || user?.accountType === 'both';
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

  plugin.contentTypes.user.schema.attributes.phoneVerified = {
    type: 'boolean',
    default: false,
  };

  plugin.contentTypes.user.schema.attributes.phoneOtpToken = {
    type: 'string',
    private: true,
  };

  plugin.contentTypes.user.schema.attributes.religion = {
    type: 'enumeration',
    enum: RELIGION_OPTIONS,
  };

  plugin.contentTypes.user.schema.attributes.isParent = {
    type: 'boolean',
    default: true,
  };

  plugin.contentTypes.user.schema.attributes.accountType = {
    type: 'enumeration',
    enum: ACCOUNT_TYPE_OPTIONS,
    default: 'parent',
  };

  plugin.contentTypes.user.schema.attributes.providerType = {
    type: 'enumeration',
    enum: PROVIDER_TYPE_OPTIONS,
  };

  plugin.contentTypes.user.schema.attributes.providerTypes = {
    type: 'json',
  };

  plugin.contentTypes.user.schema.attributes.schoolName = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.fullName = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.location = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.paymentPhone = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.paymentCode = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.educationLevel = {
    type: 'enumeration',
    enum: EDUCATION_LEVEL_OPTIONS,
  };

  plugin.contentTypes.user.schema.attributes.educationLevels = {
    type: 'json',
  };

  plugin.contentTypes.user.schema.attributes.educationLevelOther = {
    type: 'string',
  };

  plugin.contentTypes.user.schema.attributes.teacherBackground = {
    type: 'text',
  };

  plugin.contentTypes.user.schema.attributes.teachingExperience = {
    type: 'text',
  };

  plugin.contentTypes.user.schema.attributes.subjectsTaught = {
    type: 'json',
  };

  plugin.contentTypes.user.schema.attributes.subscribedTeacherIds = {
    type: 'json',
  };

  plugin.contentTypes.user.schema.attributes.hasBookLibraryAccess = {
    type: 'boolean',
    default: false,
  };

  plugin.contentTypes.user.schema.attributes.bookLibraryAccessGrantedAt = {
    type: 'datetime',
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

  plugin.contentTypes.user.schema.attributes.providerMaterials = {
    type: 'relation',
    relation: 'oneToMany',
    target: 'api::provider-material.provider-material',
    mappedBy: 'provider',
  };

  plugin.contentTypes.user.schema.attributes.lastSeenAt = {
    type: 'datetime',
  };

  plugin.contentTypes.user.schema.attributes.avatarUrl = {
    type: 'string',
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

    // Update lastSeenAt on every /users/me call (throttled to once per minute to avoid write storms)
    const nowIso = new Date().toISOString();
    try {
      const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        select: ['lastSeenAt'],
      });
      const lastSeen = existing?.lastSeenAt ? new Date(existing.lastSeenAt) : null;
      const diffMs = lastSeen ? Date.now() - lastSeen.getTime() : Infinity;
      if (diffMs > 60_000) {
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: user.id },
          data: { lastSeenAt: nowIso },
        });
      }
    } catch (_) { /* non-fatal */ }

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
      phoneVerified: !!userWithRole.phoneVerified,
      religion: userWithRole.religion || null,
      isParent: !!userWithRole.isParent,
      accountType: userWithRole.accountType || 'parent',
      providerType: userWithRole.providerType || null,
      providerTypes: normalizeProviderTypes(userWithRole.providerTypes || userWithRole.providerType),
      isSeller: normalizeProviderTypes(userWithRole.providerTypes || userWithRole.providerType).includes('seller'),
      isTeacher: normalizeProviderTypes(userWithRole.providerTypes || userWithRole.providerType).includes('teacher'),
      isReligiousProvider: normalizeProviderTypes(userWithRole.providerTypes || userWithRole.providerType).includes('religious'),
      schoolName: userWithRole.schoolName || null,
      location: userWithRole.location || null,
      paymentPhone: userWithRole.paymentPhone || null,
      paymentCode: userWithRole.paymentCode || null,
      educationLevel: userWithRole.educationLevel || null,
      educationLevels: Array.isArray(userWithRole.educationLevels)
        ? userWithRole.educationLevels.filter((level) => EDUCATION_LEVEL_OPTIONS.includes(level))
        : userWithRole.educationLevel
          ? [userWithRole.educationLevel]
          : [],
      educationLevelOther: userWithRole.educationLevelOther || null,
      teacherBackground: userWithRole.teacherBackground || null,
      teachingExperience: userWithRole.teachingExperience || null,
      subjectsTaught: Array.isArray(userWithRole.subjectsTaught) ? userWithRole.subjectsTaught : [],
      subscribedTeacherIds: Array.isArray(userWithRole.subscribedTeacherIds)
        ? userWithRole.subscribedTeacherIds.map((value) => Number(value)).filter(Number.isFinite)
        : [],
      hasBookLibraryAccess: !!userWithRole.hasBookLibraryAccess,
      bookLibraryAccessGrantedAt: userWithRole.bookLibraryAccessGrantedAt || null,
      hasParentPin: !!userWithRole.parentPinHash,
      parentPinUpdatedAt: userWithRole.parentPinUpdatedAt || null,
      childProfiles: Array.isArray(userWithRole.childProfiles)
        ? userWithRole.childProfiles.map((c) => ({
            id: c.id,
            documentId: c.documentId,
            name: c.name,
            hasPin: !!c.childPinHash,
            dateOfBirth: c.dateOfBirth,
            religion: c.religion || null,
            avatarUrl: c.avatarUrl,
            dailyWatchMinutes: c.dailyWatchMinutes,
            blockedMovieIds: Array.isArray(c.blockedMovieIds) ? c.blockedMovieIds : [],
            allowedMovieIds: Array.isArray(c.allowedMovieIds) ? c.allowedMovieIds : [],
            savingsGoals: Array.isArray(c.savingsGoals) ? c.savingsGoals : [],
            totalSavingsUGX: Number(c.totalSavingsUGX || 0),
            unallocatedSavingsUGX: Number(c.unallocatedSavingsUGX || 0),
            savingsLifetimeDepositedUGX: Number(c.savingsLifetimeDepositedUGX || 0),
          }))
        : [],
      avatarUrl: userWithRole.avatarUrl || null,
      isKeypUser: !!userWithRole.isKeypUser,
      keypActivatedAt: userWithRole.keypActivatedAt,
      lastSeenAt: userWithRole.lastSeenAt || null,
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
        const accountType = ACCOUNT_TYPE_OPTIONS.includes(body.accountType) ? body.accountType : 'parent';
        const providerType = PROVIDER_TYPE_OPTIONS.includes(body.providerType) ? body.providerType : undefined;
        const wantsProvider = accountType === 'provider' || accountType === 'both' || !!providerType;
        const wantsParent = accountType === 'parent' || accountType === 'both' || body.isParent === true || body.isParent === 'true';
        const requestedProviderTypes = normalizeProviderTypes([providerType, ...(Array.isArray(body.providerTypes) ? body.providerTypes : [])]);

        const requestedEducationLevels = Array.isArray(body.educationLevels)
          ? body.educationLevels
          : body.educationLevel
            ? [body.educationLevel]
            : [];
        const educationLevels = [...new Set(requestedEducationLevels.filter((level) => EDUCATION_LEVEL_OPTIONS.includes(level)))];
        const educationLevel = educationLevels[0];
        const educationLevelOther = typeof body.educationLevelOther === 'string' ? body.educationLevelOther.trim() : '';
        const location = typeof body.location === 'string' ? body.location.trim() : '';
        const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
        const religion = RELIGION_OPTIONS.includes(body.religion) ? body.religion : undefined;
        const isParent = wantsParent;

        if (wantsParent && body.isParent !== true && body.isParent !== 'true') {
          throw new ValidationError(accountType === 'parent' ? 'You must confirm that you are a parent to register' : 'You must agree to the Terms and Conditions');
        }

        if (accountType === 'provider' && !providerType) {
          throw new ValidationError('Select a provider type to register');
        }

        if (providerType === 'teacher') {
          if (!schoolName) {
            throw new ValidationError('School is required for teacher accounts');
          }
          if (educationLevels.length === 0) {
            throw new ValidationError('Select at least one education level for teacher accounts');
          }
          if (educationLevels.includes('Other') && !educationLevelOther) {
            throw new ValidationError('Enter the education level when selecting Other');
          }
        }

        if (providerType === 'religious' && !religion) {
          throw new ValidationError('Religion is required for religious providers');
        }

        if (wantsProvider && providerType && providerType !== 'seller' && !location) {
          throw new ValidationError('Location is required for provider accounts');
        }

        if (!normalizedPhone) {
          throw new ValidationError('Phone number is required');
        }

        const submittedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

        async function findExistingUser() {
          if (submittedEmail) {
            const byEmail = await strapi.db.query('plugin::users-permissions.user').findOne({
              where: { email: submittedEmail },
              select: ['id', 'email', 'username', 'password', 'phone', 'accountType', 'providerType', 'providerTypes', 'isParent'],
            });
            if (byEmail) return byEmail;
          }

          const users = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: { phone: { $notNull: true } },
            select: ['id', 'email', 'username', 'password', 'phone', 'accountType', 'providerType', 'providerTypes', 'isParent'],
            limit: 20000,
          });

          return users.find((entry) => normalizePhone(entry.phone) === normalizedPhone) || null;
        }

        const existingUser = await findExistingUser();
        if (existingUser) {
          const passwordMatches = existingUser.password && await bcrypt.compare(String(body.password || ''), existingUser.password);
          if (!passwordMatches) {
            throw new ValidationError('An account already exists with this phone or email. Enter the same password when filing this form to link them together.');
          }

          const currentProviderTypes = normalizeProviderTypes(existingUser.providerTypes || existingUser.providerType);
          const mergedProviderTypes = normalizeProviderTypes([...currentProviderTypes, ...requestedProviderTypes]);
          const willBeParent = !!existingUser.isParent || wantsParent;
          const willBeProvider = userHasProviderAccess(existingUser) || wantsProvider || mergedProviderTypes.length > 0;
          const nextAccountType = willBeParent && willBeProvider ? 'both' : willBeProvider ? 'provider' : 'parent';
          const updateData = {
            accountType: nextAccountType,
            isParent: willBeParent,
            phone: existingUser.phone || normalizedPhone,
          };

          if (mergedProviderTypes.length > 0) {
            updateData.providerTypes = mergedProviderTypes;
            updateData.providerType = providerType || existingUser.providerType || mergedProviderTypes[0];
          }
          if (typeof body.fullName === 'string' && body.fullName.trim()) updateData.fullName = body.fullName.trim();
          if (religion) updateData.religion = religion;
          if (location) updateData.location = location;
          if (schoolName) updateData.schoolName = schoolName;
          if (educationLevel) updateData.educationLevel = educationLevel;
          if (educationLevels.length > 0) updateData.educationLevels = educationLevels;
          if (educationLevels.includes('Other')) updateData.educationLevelOther = educationLevelOther;

          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: existingUser.id },
            data: updateData,
          });

          const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: existingUser.id });
          const userWithRole = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: existingUser.id },
            populate: ['role'],
          });

          ctx.body = { jwt, user: userWithRole };
          return;
        }

        const extras = {
          fullName: typeof body.fullName === 'string' ? body.fullName.trim() : undefined,
          phone: normalizedPhone || undefined,
          religion,
          isParent,
          accountType,
          providerType,
          providerTypes: requestedProviderTypes.length > 0 ? requestedProviderTypes : undefined,
          location: location || undefined,
          schoolName: schoolName || undefined,
          educationLevel,
          educationLevels: educationLevels.length > 0 ? educationLevels : undefined,
          educationLevelOther: educationLevels.includes('Other') ? educationLevelOther : undefined,
        };

        // Email is optional on phone-first signup. Strapi's core register
        // validator still requires an email-shaped string + uniqueness, so
        // synthesize a deterministic placeholder from the phone when the user
        // didn't provide one. The user can update it later from their profile.
        const effectiveEmail = submittedEmail || `${normalizedPhone}@phone.movokids.local`;

        // Strapi v5's users-permissions register validator rejects unknown keys
        // (e.g. religion, isParent, accountType, providerType, phone, fullName)
        // before reaching our wrapper,
        // so we strip them off the request body, let the core handler run with
        // only the canonical { username, email, password }, then patch the new
        // user with our extras afterwards.
        ctx.request.body = {
          username: body.username,
          email: effectiveEmail,
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
        if (extras.accountType) updateData.accountType = extras.accountType;
        if (extras.providerType) updateData.providerType = extras.providerType;
        if (extras.providerTypes) updateData.providerTypes = extras.providerTypes;
        if (extras.location) updateData.location = extras.location;
        if (extras.schoolName) updateData.schoolName = extras.schoolName;
        if (extras.educationLevel) updateData.educationLevel = extras.educationLevel;
        if (extras.educationLevels) updateData.educationLevels = extras.educationLevels;
        if (extras.educationLevelOther) updateData.educationLevelOther = extras.educationLevelOther;
        if (extras.accountType === 'provider') updateData.isParent = false;

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

        // Send phone-OTP for verification (best-effort, non-blocking failure).
        if (extras.phone) {
          try {
            const otp = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            await strapi.db.query('plugin::users-permissions.user').update({
              where: { id: created.id },
              data: {
                phoneOtpToken: JSON.stringify({ code: otp, expiresAt: expiresAt.toISOString() }),
              },
            });

            await sendSms({
              to: extras.phone,
              message: `Welcome to Movo kids! Your verification code is ${otp}. It expires in 10 minutes.`,
            });
            strapi.log.info(`[register-extension] OTP sent to ${extras.phone}`);
          } catch (err) {
            strapi.log.warn(`[register-extension] OTP send failed: ${err.message}`);
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
