'use strict';

function sanitizeBucketSegment(value) {
  const normalized = String(value || 'user')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');

  return normalized || 'user';
}

async function getUserById(strapi, userId) {
  if (!userId) return null;
  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'username', 'email'],
  });
}

function getSpacePrefixForUser(user) {
  const base = sanitizeBucketSegment(user?.username || user?.email?.split('@')?.[0] || 'user');
  return `mrkeyp/${base}-${user.id}`;
}

function getRequestedSpaceOwnerId(ctx) {
  const raw = ctx.request.header['x-mrkeyp-space-owner'];
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getAccessibleSpace(strapi, currentUser, requestedOwnerId) {
  const ownerId = requestedOwnerId || currentUser.id;

  if (ownerId === currentUser.id) {
    const owner = await getUserById(strapi, currentUser.id);
    return owner ? { ownerId: owner.id, owner, isShared: false } : null;
  }

  const memberships = await strapi.entityService.findMany('api::account-invitation.account-invitation', {
    filters: {
      inviter: { id: ownerId },
      invitee: { id: currentUser.id },
      status: 'accepted',
    },
    populate: {
      inviter: { fields: ['id', 'username', 'email'] },
    },
    limit: 1,
  });

  if (!memberships || memberships.length === 0) return null;

  const owner = memberships[0].inviter;
  return owner ? { ownerId: owner.id, owner, isShared: true, membership: memberships[0] } : null;
}

module.exports = {
  sanitizeBucketSegment,
  getUserById,
  getSpacePrefixForUser,
  getRequestedSpaceOwnerId,
  getAccessibleSpace,
};