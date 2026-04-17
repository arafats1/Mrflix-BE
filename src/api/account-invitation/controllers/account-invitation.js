'use strict';

const crypto = require('crypto');

function getBaseUrl() {
  return process.env.MRKEYP_URL || process.env.FRONTEND_URL;
}

function serializeInvitation(invitation) {
  return {
    id: invitation.id,
    token: invitation.token,
    inviteeEmail: invitation.inviteeEmail,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    inviter: invitation.inviter
      ? {
          id: invitation.inviter.id,
          username: invitation.inviter.username,
          email: invitation.inviter.email,
        }
      : null,
    invitee: invitation.invitee
      ? {
          id: invitation.invitee.id,
          username: invitation.invitee.username,
          email: invitation.invitee.email,
        }
      : null,
    inviteUrl: `${getBaseUrl()}/invite/${invitation.token}`,
  };
}

async function getInvitationByToken(token) {
  const entries = await strapi.entityService.findMany('api::account-invitation.account-invitation', {
    filters: { token },
    populate: {
      inviter: { fields: ['id', 'username', 'email'] },
      invitee: { fields: ['id', 'username', 'email'] },
    },
    limit: 1,
  });

  return entries && entries.length > 0 ? entries[0] : null;
}

function isExpired(invitation) {
  return invitation.expiresAt && new Date(invitation.expiresAt) < new Date();
}

module.exports = {
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const invitation = await strapi.entityService.create('api::account-invitation.account-invitation', {
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        inviter: ctx.state.user.id,
        invitee: null,
        inviteeEmail: null,
        status: 'pending',
        expiresAt: expiresAt.toISOString(),
      },
      populate: {
        inviter: { fields: ['id', 'username', 'email'] },
        invitee: { fields: ['id', 'username', 'email'] },
      },
    });

    return { data: serializeInvitation(invitation) };
  },

  async preview(ctx) {
    const invitation = await getInvitationByToken(ctx.params.token);
    if (!invitation) return ctx.notFound('Invitation not found');

    if (isExpired(invitation) && invitation.status === 'pending') {
      await strapi.entityService.update('api::account-invitation.account-invitation', invitation.id, {
        data: { status: 'expired' },
      });
      invitation.status = 'expired';
    }

    return { data: serializeInvitation(invitation) };
  },

  async accept(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const invitation = await getInvitationByToken(ctx.params.token);
    if (!invitation) return ctx.notFound('Invitation not found');

    const isGenericLink = !invitation.inviteeEmail;

    if (isGenericLink) {
      if (isExpired(invitation)) {
        return ctx.badRequest('This invitation link has expired');
      }

      const existingMembership = await strapi.entityService.findMany('api::account-invitation.account-invitation', {
        filters: {
          inviter: { id: invitation.inviter?.id },
          invitee: { id: ctx.state.user.id },
          status: 'accepted',
        },
        populate: {
          inviter: { fields: ['id', 'username', 'email'] },
          invitee: { fields: ['id', 'username', 'email'] },
        },
        limit: 1,
      });

      if (existingMembership && existingMembership.length > 0) {
        return { data: serializeInvitation(existingMembership[0]) };
      }

      const createdMembership = await strapi.entityService.create('api::account-invitation.account-invitation', {
        data: {
          token: crypto.randomBytes(32).toString('hex'),
          inviter: invitation.inviter?.id,
          invitee: ctx.state.user.id,
          inviteeEmail: ctx.state.user.email || null,
          status: 'accepted',
          expiresAt: invitation.expiresAt || null,
          acceptedAt: new Date().toISOString(),
        },
        populate: {
          inviter: { fields: ['id', 'username', 'email'] },
          invitee: { fields: ['id', 'username', 'email'] },
        },
      });

      return { data: serializeInvitation(createdMembership) };
    }

    if (invitation.status === 'accepted' && invitation.invitee?.id === ctx.state.user.id) {
      return { data: serializeInvitation(invitation) };
    }

    if (invitation.status !== 'pending') {
      return ctx.badRequest('This invitation is no longer available');
    }

    if (isExpired(invitation)) {
      await strapi.entityService.update('api::account-invitation.account-invitation', invitation.id, {
        data: { status: 'expired' },
      });
      return ctx.badRequest('This invitation has expired');
    }

    const currentEmail = String(ctx.state.user.email || '').trim().toLowerCase();
    if (currentEmail !== invitation.inviteeEmail) {
      return ctx.forbidden('This invitation was sent to a different email address');
    }

    const updated = await strapi.entityService.update('api::account-invitation.account-invitation', invitation.id, {
      data: {
        invitee: ctx.state.user.id,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      },
      populate: {
        inviter: { fields: ['id', 'username', 'email'] },
        invitee: { fields: ['id', 'username', 'email'] },
      },
    });

    return { data: serializeInvitation(updated) };
  },

  async mine(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const [sent, members, sharedWithMe] = await Promise.all([
      strapi.entityService.findMany('api::account-invitation.account-invitation', {
        filters: {
          inviter: { id: ctx.state.user.id },
          invitee: { id: { $null: true } },
        },
        populate: {
          inviter: { fields: ['id', 'username', 'email'] },
          invitee: { fields: ['id', 'username', 'email'] },
        },
        sort: 'createdAt:desc',
      }),
      strapi.entityService.findMany('api::account-invitation.account-invitation', {
        filters: {
          inviter: { id: ctx.state.user.id },
          invitee: { id: { $notNull: true } },
          status: 'accepted',
        },
        populate: {
          inviter: { fields: ['id', 'username', 'email'] },
          invitee: { fields: ['id', 'username', 'email'] },
        },
        sort: 'acceptedAt:desc',
      }),
      strapi.entityService.findMany('api::account-invitation.account-invitation', {
        filters: {
          invitee: { id: ctx.state.user.id },
          status: 'accepted',
        },
        populate: {
          inviter: { fields: ['id', 'username', 'email'] },
          invitee: { fields: ['id', 'username', 'email'] },
        },
        sort: 'acceptedAt:desc',
      }),
    ]);

    return {
      data: {
        sent: (sent || []).map(serializeInvitation),
        members: (members || []).map(serializeInvitation),
        sharedWithMe: (sharedWithMe || []).map(serializeInvitation),
      },
    };
  },

  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized('You must be logged in');

    const invitation = await strapi.entityService.findOne('api::account-invitation.account-invitation', ctx.params.id, {
      populate: {
        inviter: { fields: ['id', 'username', 'email'] },
        invitee: { fields: ['id', 'username', 'email'] },
      },
    });

    if (!invitation) return ctx.notFound('Invitation not found');
    if (invitation.inviter?.id !== ctx.state.user.id) return ctx.forbidden('Access denied');

    await strapi.entityService.delete('api::account-invitation.account-invitation', invitation.id);
    return { data: { success: true } };
  },
};