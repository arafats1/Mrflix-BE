'use strict';

function normalizeProviderTypes(input) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function isBuyerOnlyAccount(user) {
  if (!user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return email.endsWith('@buyer.movo.local');
}

function canAccessParentDashboard(user) {
  if (!user) return false;

  const isParentFalse = user.isParent === false || user.isParent === 0;
  if (isBuyerOnlyAccount(user) && isParentFalse) return false;
  if (user.isParent === true || user.isParent === 1) return true;
  if (user.accountType === 'both' || user.accountType === 'parent') return true;

  const providerTypes = normalizeProviderTypes(user.providerTypes || user.providerType);
  if (user.accountType === 'provider') return true;
  if (providerTypes.includes('seller')) return true;

  return false;
}

async function loadParentAccessUser(strapi, userId) {
  if (!userId) return null;
  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: [
      'id',
      'email',
      'isParent',
      'accountType',
      'providerType',
      'providerTypes',
      'parentPinHash',
    ],
  });
}

async function ensureUnifiedParentAccess(strapi, userId) {
  const user = await loadParentAccessUser(strapi, userId);
  if (!user || !canAccessParentDashboard(user)) {
    return { user, allowed: false };
  }

  if (!user.isParent) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: { isParent: true },
    });
    user.isParent = true;
  }

  return { user, allowed: true };
}

module.exports = {
  normalizeProviderTypes,
  isBuyerOnlyAccount,
  canAccessParentDashboard,
  loadParentAccessUser,
  ensureUnifiedParentAccess,
};
