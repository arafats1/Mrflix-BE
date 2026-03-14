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

    // Calculate remaining free movies for this user
    const credits = await getRemainingCredits(strapi, userId);

    const frontendUrl = process.env.FRONTEND_URL || 'https://mrflix.ug';

    return {
      data: {
        code,
        link: `${frontendUrl}/auth/register?ref=${code}`,
        totalReferred: activatedReferrals.length,
        rewardMovies,
        hasAppliedCode: appliedCode.length > 0,
        freeMoviesRemaining: credits,
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

    // Create the activated referral record with credit balances for both users
    await strapi.documents('api::referral.referral').create({
      data: {
        referrer: referrerId,
        referred: userId,
        code: code.toUpperCase(),
        status: 'activated',
        rewardMovieCount: rewardMovies,
        referrerMoviesRemaining: rewardMovies,
        referredMoviesRemaining: rewardMovies,
      },
    });

    return {
      data: {
        success: true,
        message: `Referral code applied! You and the referrer each get ${rewardMovies} free movies. Go to any movie and use your free credit!`,
        rewardMovies,
      },
    };
  },

  // GET /referrals/my-credits — Get user's remaining free movie credits
  async myCredits(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userId = ctx.state.user.id;
    const remaining = await getRemainingCredits(strapi, userId);

    return {
      data: {
        freeMoviesRemaining: remaining,
      },
    };
  },

  // POST /referrals/use-credit — Use a referral credit to unlock a movie
  async useCredit(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId } = ctx.request.body.data || ctx.request.body;
    if (!movieId) {
      return ctx.badRequest('Missing required field: movieId');
    }

    const userId = ctx.state.user.id;

    // Get the movie
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) {
      return ctx.notFound('Movie not found');
    }

    // Only movies, not series
    if (movie.type === 'series') {
      return ctx.badRequest('Referral credits can only be used for movies, not series');
    }

    // Check if already purchased
    const existing = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: { id: userId },
        movie: { id: movie.id },
        status: 'completed',
      },
    });

    if (existing && existing.length > 0) {
      return ctx.badRequest('You already own this movie');
    }

    // Find a referral record with remaining credits for this user
    // Check as referred user first
    const asReferred = await strapi.entityService.findMany('api::referral.referral', {
      filters: {
        referred: { id: userId },
        status: { $in: ['activated', 'rewarded'] },
        referredMoviesRemaining: { $gt: 0 },
      },
      limit: 1,
    });

    let referralRecord = null;
    let creditField = null;

    if (asReferred.length > 0) {
      referralRecord = asReferred[0];
      creditField = 'referredMoviesRemaining';
    } else {
      // Check as referrer
      const asReferrer = await strapi.entityService.findMany('api::referral.referral', {
        filters: {
          referrer: { id: userId },
          status: { $in: ['activated', 'rewarded'] },
          referrerMoviesRemaining: { $gt: 0 },
        },
        limit: 1,
      });

      if (asReferrer.length > 0) {
        referralRecord = asReferrer[0];
        creditField = 'referrerMoviesRemaining';
      }
    }

    if (!referralRecord || !creditField) {
      return ctx.badRequest('You have no remaining referral credits');
    }

    // Create the free purchase
    await strapi.documents('api::purchase.purchase').create({
      data: {
        buyer: userId,
        movie: movie.id,
        amount: 0,
        paymentMethod: creditField === 'referredMoviesRemaining' ? 'referral_referred' : 'referral_referrer',
        transactionId: `REF_${userId}_${movie.id}_${Date.now()}`,
        status: 'completed',
        downloadCount: 0,
      },
    });

    // Decrement the credit
    const newRemaining = referralRecord[creditField] - 1;
    await strapi.entityService.update('api::referral.referral', referralRecord.id, {
      data: {
        [creditField]: newRemaining,
      },
    });

    // Calculate total remaining across all referral records
    const totalRemaining = await getRemainingCredits(strapi, userId);

    return {
      data: {
        success: true,
        message: `Free movie unlocked! You have ${totalRemaining} free movie${totalRemaining === 1 ? '' : 's'} remaining.`,
        freeMoviesRemaining: totalRemaining,
      },
    };
  },

  // GET /referrals — Admin: List all referrals
  async adminList(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const isAdmin = ctx.state.user.role?.type === 'admin' || ctx.state.user.role?.name === 'Admin';
      if (!isAdmin) {
        return ctx.forbidden('Only admins can view all referrals');
      }

      const entries = await strapi.entityService.findMany('api::referral.referral', {
        populate: {
          referrer: { fields: ['username', 'email'] },
          referred: { fields: ['username', 'email'] },
        },
        sort: { createdAt: 'desc' },
      });

      // Keep only applied referral rows (rows with a referred user).
      const activity = (entries || []).filter((x) => !!x?.referred);

      return { data: activity };
    } catch (err) {
      strapi.log.error('Referral find error:', err);
      return ctx.internalServerError('Failed to fetch referrals');
    }
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
 * Get the total remaining referral movie credits for a user
 * Sums credits from all referral records where the user is either a referrer or referred
 */
async function getRemainingCredits(strapi, userId) {
  let total = 0;

  // Credits as a referred user
  const asReferred = await strapi.entityService.findMany('api::referral.referral', {
    filters: {
      referred: { id: userId },
      status: { $in: ['activated', 'rewarded'] },
      referredMoviesRemaining: { $gt: 0 },
    },
  });
  for (const r of asReferred) {
    total += r.referredMoviesRemaining || 0;
  }

  // Credits as a referrer
  const asReferrer = await strapi.entityService.findMany('api::referral.referral', {
    filters: {
      referrer: { id: userId },
      status: { $in: ['activated', 'rewarded'] },
      referrerMoviesRemaining: { $gt: 0 },
    },
  });
  for (const r of asReferrer) {
    total += r.referrerMoviesRemaining || 0;
  }

  return total;
}
