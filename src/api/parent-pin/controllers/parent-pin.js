'use strict';

const bcrypt = require('bcryptjs');
const { ensureUnifiedParentAccess } = require('../../../utils/parent-access');

const PIN_PATTERN = /^\d{4}$/;

module.exports = {
  async set(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) return ctx.unauthorized();

    const { user: currentUser, allowed } = await ensureUnifiedParentAccess(strapi, authUser.id);
    if (!allowed || !currentUser) {
      return ctx.forbidden('Only parent accounts can set a parent PIN');
    }

    const { pin, currentPin } = ctx.request.body || {};

    if (!PIN_PATTERN.test(String(pin || ''))) {
      return ctx.badRequest('PIN must be exactly 4 digits');
    }

    if (currentUser.parentPinHash) {
      if (!PIN_PATTERN.test(String(currentPin || ''))) {
        return ctx.badRequest('Current PIN is required to change your parent PIN');
      }

      const matchesCurrent = await bcrypt.compare(String(currentPin), currentUser.parentPinHash);
      if (!matchesCurrent) {
        return ctx.badRequest('Current PIN is incorrect');
      }
    }

    const parentPinHash = await bcrypt.hash(String(pin), 10);
    const parentPinUpdatedAt = new Date().toISOString();

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: authUser.id },
      data: {
        parentPinHash,
        parentPinUpdatedAt,
      },
    });

    ctx.body = {
      data: {
        hasParentPin: true,
        parentPinUpdatedAt,
      },
    };
  },

  async verify(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) return ctx.unauthorized();

    const { user: currentUser, allowed } = await ensureUnifiedParentAccess(strapi, authUser.id);
    if (!allowed || !currentUser) {
      return ctx.forbidden('Only parent accounts can verify a parent PIN');
    }

    if (!currentUser.parentPinHash) {
      return ctx.badRequest('No parent PIN has been set');
    }

    const { pin } = ctx.request.body || {};
    if (!PIN_PATTERN.test(String(pin || ''))) {
      return ctx.badRequest('PIN must be exactly 4 digits');
    }

    const matches = await bcrypt.compare(String(pin), currentUser.parentPinHash);
    if (!matches) {
      return ctx.badRequest('Incorrect PIN');
    }

    ctx.body = {
      data: {
        verified: true,
      },
    };
  },
};