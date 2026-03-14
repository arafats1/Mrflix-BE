'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');

/**
 * Generate a unique 8-character referral code
 */
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = createCoreController('api::referral.referral', ({ strapi }) => ({
  // GET /referrals/my-code — Get or create user's referral code
  async myCode(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userId = ctx.state.user.id;

    // Check if user already has a referral code entry (as referrer)
    let referrals = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        referrer: { id: userId },
        referred: { id: { $null: true } },
      },
      populate: ['referrer'],
      limit: 1,
    });

    let code;
    if (referrals.length > 0) {
      code = referrals[0].code;
    } else {
      // Create a new referral code for this user
      code = generateReferralCode();
      // Ensure uniqueness
      let exists = await strapi.entityService.findMany('api::referral.referral', {
        filters: { code },
        limit: 1,
      });
      while (exists.length > 0) {
        code = generateReferralCode();
        exists = await strapi.entityService.findMany('api::referral.referral', {
          filters: { code },
          limit: 1,
        });
      }

      await strapi.entityService.create('api::referral.referral', {
        data: {
          referrer: userId,
          code,
          status: 'pending',
        },
      });
    }

    // Count total successful referrals by this user
    const activatedReferrals = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        referrer: { id: userId },
        status: { $in: ['activated', 'rewarded'] },
      },
    });

    // Check if user has applied someone else's code
    const appliedCode = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        referred: { id: userId },
      },
      limit: 1,
    });

    // Get reward amount from settings
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const rewardMovies = settings?.referralRewardMovies || 3;

    const frontendUrl = process.env.FRONTEND_URL || 'https://mrflix.ug';

    return {
      data: {
        code,
        link: `${frontendUrl}/auth/register?ref=${code}`,
        totalReferred: activatedReferrals.length,
        rewardMovies,
        hasAppliedCode: appliedCode.length > 0,
      },
    };
  },

  // POST /referrals/apply — Apply a referral code (new user activates)
  async apply(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { code } = ctx.request.body;
    if (!code || typeof code !== 'string') {
      return ctx.badRequest('Referral code is required');
    }

    const userId = ctx.state.user.id;

    // Check if user already used a referral code
    const alreadyReferred = await strapi.entityService.findMany('api::referral.referral', {
      filters: { referred: { id: userId } },
      limit: 1,
    });

    if (alreadyReferred.length > 0) {
      return ctx.badRequest('You have already used a referral code');
    }

    // Find the referral code entry (the template row with no referred user)
    const codeEntries = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        code: code.toUpperCase(),
        referred: { id: { $null: true } },
      },
      populate: ['referrer'],
      limit: 1,
    });

    if (codeEntries.length === 0) {
      return ctx.badRequest('Invalid referral code');
    }

    const referralTemplate = codeEntries[0];

    // Can't refer yourself
    if (referralTemplate.referrer?.id === userId) {
      return ctx.badRequest('You cannot use your own referral code');
    }

    const referrerId = referralTemplate.referrer?.id;

    // Prevent circular referrals: if the current user has already referred the code owner, block it
    const circularCheck = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        referrer: { id: userId },
        referred: { id: referrerId },
        status: { $in: ['activated', 'rewarded'] },
      },
      limit: 1,
    });

    if (circularCheck.length > 0) {
      return ctx.badRequest('You cannot use a referral code from someone you already referred');
    }

    // Only allow referral code application for new accounts (within 10 minutes of registration)
    const userRecord = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
    });
    if (userRecord) {
      const accountAge = Date.now() - new Date(userRecord.createdAt).getTime();
      const tenMinutes = 10 * 60 * 1000;
      if (accountAge > tenMinutes) {
        return ctx.badRequest('Referral codes can only be applied during sign up');
      }
    }
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const rewardMovies = settings?.referralRewardMovies || 3;

    // Create the activated referral record using documents API
    await strapi.documents('api::referral.referral').create({
      data: {
        referrer: referrerId,
        referred: userId,
        code: code.toUpperCase(),
        status: 'activated',
        rewardMovieCount: rewardMovies,
        referrerRewarded: false,
        referredRewarded: false,
      },
    });

    // Grant rewards to both users — create "free reward" purchases
    // For the referred user (new user)
    await grantReferralReward(strapi, userId, rewardMovies, 'referral_referred');

    // For the referrer
    await grantReferralReward(strapi, referrerId, rewardMovies, 'referral_referrer');

    return {
      data: {
        success: true,
        message: `Referral code applied! You and the referrer each get ${rewardMovies} free movies or 1 full season.`,
        rewardMovies,
      },
    };
  },

  // GET /referrals — Admin: List all referrals
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can view all referrals');
    }

    const entries = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        status: { $in: ['activated', 'rewarded'] },
      },
      populate: {
        referrer: { fields: ['username', 'email', 'fullName'] },
        referred: { fields: ['username', 'email', 'fullName'] },
      },
      sort: 'createdAt:desc',
    });

    return { data: entries };
  },

  // GET /referrals/settings — Get referral settings
  async getSettings(ctx) {
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    return {
      data: {
        referralEnabled: settings?.referralEnabled !== false,
        referralRewardMovies: settings?.referralRewardMovies || 3,
      },
    };
  },

  // PUT /referrals/settings — Admin: Update referral settings
  async updateSettings(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can update referral settings');
    }

    const { referralEnabled, referralRewardMovies } = ctx.request.body.data || ctx.request.body;
    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');

    const updateData = {};
    if (typeof referralEnabled === 'boolean') updateData.referralEnabled = referralEnabled;
    if (referralRewardMovies != null) updateData.referralRewardMovies = parseInt(referralRewardMovies) || 3;

    await strapi.entityService.update('api::site-setting.site-setting', settings.id, {
      data: updateData,
    });

    return { data: { success: true } };
  },
}));

/**
 * Grant referral reward — creates free purchases for the user
 * Picks the top N most-watched movies the user hasn't purchased
 */
async function grantReferralReward(strapi, userId, movieCount, source) {
  try {
    // Get user's existing purchases using documents API (consistent with purchase controller)
    const existingPurchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: { id: userId },
        status: 'completed',
      },
      populate: ['movie'],
    });

    const purchasedIds = new Set(
      existingPurchases.map(p => String(p.movie?.documentId || p.movie?.id)).filter(Boolean)
    );

    // Get popular available movies user hasn't purchased
    const movies = await strapi.documents('api::movie.movie').findMany({
      filters: { isAvailable: true },
      sort: [{ watchCount: 'desc' }, { rating: 'desc' }],
      limit: 50,
    });

    const eligible = movies.filter(m => !purchasedIds.has(String(m.documentId)) && !purchasedIds.has(String(m.id)));
    const toGrant = eligible.slice(0, movieCount);

    // Create free "reward" purchases using documents API (matches how free-trial creates purchases)
    for (const movie of toGrant) {
      await strapi.documents('api::purchase.purchase').create({
        data: {
          buyer: userId,
          movie: movie.id,
          amount: 0,
          paymentMethod: source,
          transactionId: `REF_${userId}_${movie.id}_${Date.now()}`,
          status: 'completed',
          downloadCount: 0,
        },
      });
    }
  } catch (err) {
    strapi.log.error(`Failed to grant referral reward for user ${userId}:`, err);
  }
}
