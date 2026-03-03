'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');

module.exports = createCoreController('api::tv-code.tv-code', ({ strapi }) => ({
  /**
   * Generate a 6-digit pairing code for the logged-in user (web flow).
   * POST /tv-codes/generate
   */
  async generate(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Delete any existing unexpired codes for this user
    const existing = await strapi.documents('api::tv-code.tv-code').findMany({
      filters: {
        user: { id: ctx.state.user.id },
        claimed: false,
      },
    });

    for (const entry of existing) {
      await strapi.documents('api::tv-code.tv-code').delete({
        documentId: entry.documentId || entry.id,
      });
    }

    // Generate a unique 6-digit numeric code
    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = String(crypto.randomInt(100000, 999999));
      const dup = await strapi.documents('api::tv-code.tv-code').findMany({
        filters: { code },
      });
      if (!dup || dup.length === 0) break;
      attempts++;
    }

    // Code expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const entry = await strapi.documents('api::tv-code.tv-code').create({
      data: {
        code,
        user: ctx.state.user.id,
        expiresAt,
        claimed: false,
      },
    });

    ctx.body = {
      code,
      expiresAt,
    };
  },

  /**
   * TV app generates a code WITHOUT authentication (QR flow).
   * The code has no user yet — user claims it from the web.
   * POST /tv-codes/generate-for-tv
   */
  async generateForTV(ctx) {
    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = String(crypto.randomInt(100000, 999999));
      const dup = await strapi.documents('api::tv-code.tv-code').findMany({
        filters: { code },
      });
      if (!dup || dup.length === 0) break;
      attempts++;
    }

    // Code expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await strapi.documents('api::tv-code.tv-code').create({
      data: {
        code,
        expiresAt,
        claimed: false,
        // No user — will be claimed by the web user
      },
    });

    ctx.body = {
      code,
      expiresAt,
    };
  },

  /**
   * Web user claims a TV-generated code, linking it to their account.
   * POST /tv-codes/claim
   * Body: { code: "123456" }
   */
  async claim(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { code } = ctx.request.body;
    if (!code) {
      return ctx.badRequest('Code is required');
    }

    const entries = await strapi.documents('api::tv-code.tv-code').findMany({
      filters: {
        code: String(code),
        claimed: false,
      },
    });

    if (!entries || entries.length === 0) {
      return ctx.badRequest('Invalid or expired code');
    }

    const entry = entries[0];

    if (new Date(entry.expiresAt) < new Date()) {
      await strapi.documents('api::tv-code.tv-code').delete({
        documentId: entry.documentId || entry.id,
      });
      return ctx.badRequest('Code has expired. Please generate a new one on your TV.');
    }

    // Link the code to this user and mark as claimed
    await strapi.documents('api::tv-code.tv-code').update({
      documentId: entry.documentId || entry.id,
      data: {
        user: ctx.state.user.id,
        claimed: true,
      },
    });

    ctx.body = { success: true, message: 'TV linked successfully!' };
  },

  /**
   * TV polls to check if its code has been claimed.
   * Returns JWT + user if claimed.
   * POST /tv-codes/poll
   * Body: { code: "123456" }
   */
  async poll(ctx) {
    const { code } = ctx.request.body;
    if (!code) {
      return ctx.badRequest('Code is required');
    }

    const entries = await strapi.documents('api::tv-code.tv-code').findMany({
      filters: {
        code: String(code),
      },
      populate: { user: { populate: '*' } },
    });

    if (!entries || entries.length === 0) {
      return ctx.badRequest('Invalid or expired code');
    }

    const entry = entries[0];

    if (new Date(entry.expiresAt) < new Date()) {
      await strapi.documents('api::tv-code.tv-code').delete({
        documentId: entry.documentId || entry.id,
      });
      return ctx.badRequest('Code has expired');
    }

    if (!entry.claimed || !entry.user) {
      // Not yet claimed — TV should keep polling
      ctx.body = { status: 'pending' };
      return;
    }

    // Claimed! Issue JWT for the user and clean up
    const user = entry.user;
    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
      id: user.id,
    });

    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: ['role'],
    });

    // Delete the used code
    await strapi.documents('api::tv-code.tv-code').delete({
      documentId: entry.documentId || entry.id,
    });

    ctx.body = {
      status: 'linked',
      jwt,
      user: {
        id: fullUser.id,
        username: fullUser.username,
        email: fullUser.email,
        fullName: fullUser.fullName,
        role: fullUser.role,
      },
    };
  },

  /**
   * TV app verifies a code and gets back a JWT + user info (manual entry flow).
   * POST /tv-codes/verify
   * Body: { code: "123456" }
   */
  async verify(ctx) {
    const { code } = ctx.request.body;

    if (!code) {
      return ctx.badRequest('Code is required');
    }

    const entries = await strapi.documents('api::tv-code.tv-code').findMany({
      filters: {
        code: String(code),
        claimed: false,
      },
      populate: { user: { populate: '*' } },
    });

    if (!entries || entries.length === 0) {
      return ctx.badRequest('Invalid or expired code');
    }

    const entry = entries[0];

    // Check expiry
    if (new Date(entry.expiresAt) < new Date()) {
      await strapi.documents('api::tv-code.tv-code').delete({
        documentId: entry.documentId || entry.id,
      });
      return ctx.badRequest('Code has expired. Please generate a new one.');
    }

    // Mark as claimed
    await strapi.documents('api::tv-code.tv-code').update({
      documentId: entry.documentId || entry.id,
      data: { claimed: true },
    });

    // Issue a JWT for the user
    const user = entry.user;
    if (!user) {
      return ctx.badRequest('No user associated with this code');
    }

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
      id: user.id,
    });

    // Get user with role
    const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: ['role'],
    });

    ctx.body = {
      jwt,
      user: {
        id: fullUser.id,
        username: fullUser.username,
        email: fullUser.email,
        fullName: fullUser.fullName,
        role: fullUser.role,
      },
    };
  },
}));
