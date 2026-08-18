'use strict';

const KYC_UID = 'api::car-kyc.car-kyc';

function trim(value) {
  return String(value ?? '').trim();
}

function normalizeUgPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('256')) return digits;
  return digits ? `256${digits}` : '';
}

function phoneFromEmail(email) {
  const value = trim(email).toLowerCase();
  if (!value.endsWith('@phone.movokids.local')) return '';
  return normalizeUgPhone(value.split('@')[0]);
}

function identityKeys(user) {
  const keys = new Set();
  if (user?.id) keys.add(`id:${user.id}`);
  if (user?.documentId) keys.add(`doc:${user.documentId}`);

  const email = trim(user?.email).toLowerCase();
  if (email) keys.add(`email:${email}`);

  const phones = [user?.phone, phoneFromEmail(email)].map(normalizeUgPhone).filter(Boolean);
  for (const phone of phones) keys.add(`phone:${phone}`);
  return keys;
}

function rowMatchesUser(row, user) {
  if (!row || !user) return false;
  const keys = identityKeys(user);
  const owner = row.user && typeof row.user === 'object' ? row.user : null;
  const ownerId = owner?.id || (typeof row.user === 'number' ? row.user : null);

  if (ownerId && keys.has(`id:${ownerId}`)) return true;
  if (owner?.documentId && keys.has(`doc:${owner.documentId}`)) return true;

  const email = trim(row.contactEmail || owner?.email).toLowerCase();
  if (email && keys.has(`email:${email}`)) return true;

  const phones = [
    row.phone,
    owner?.phone,
    phoneFromEmail(email),
    phoneFromEmail(owner?.email),
  ].map(normalizeUgPhone).filter(Boolean);

  return phones.some((phone) => keys.has(`phone:${phone}`));
}

async function tryFind(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function findCarKycForUser(strapi, user) {
  if (!user?.id) return null;

  const populateUser = { user: { fields: ['id', 'documentId', 'email', 'phone'] } };

  const link = await tryFind(() => strapi.db.connection('car_kycs_user_lnk').where({ user_id: user.id }).first());
  if (link?.car_kyc_id) {
    const byId = await tryFind(() => strapi.db.query(KYC_UID).findOne({
      where: { id: link.car_kyc_id },
      populate: ['user'],
    }));
    if (byId) return byId;
  }

  const byDocuments = await tryFind(() => strapi.documents(KYC_UID).findMany({
    filters: {
      $or: [
        { user: { id: { $eq: user.id } } },
        ...(user.documentId ? [{ user: { documentId: { $eq: user.documentId } } }] : []),
      ],
    },
    populate: ['user'],
    limit: 5,
  }));
  if (byDocuments?.[0]) return byDocuments[0];

  const byEntity = await tryFind(() => strapi.entityService.findMany(KYC_UID, {
    filters: { user: { id: user.id } },
    populate: populateUser,
    limit: 5,
  }));
  if (byEntity?.[0]) return byEntity[0];

  const byDb = await tryFind(() => strapi.db.query(KYC_UID).findOne({
    where: { user: user.id },
    populate: ['user'],
  }));
  if (byDb) return byDb;

  const rows = await strapi.entityService.findMany(KYC_UID, {
    populate: populateUser,
    sort: { updatedAt: 'desc' },
    limit: 500,
  });

  const match = (rows || []).find((row) => rowMatchesUser(row, user));
  if (!match) return null;

  const ownerId = match.user?.id || (typeof match.user === 'number' ? match.user : null);
  if (!ownerId) {
    await tryFind(() => strapi.entityService.update(KYC_UID, match.id, {
      data: { user: user.id },
    }));
  }

  return match;
}

module.exports = {
  KYC_UID,
  normalizeUgPhone,
  findCarKycForUser,
};
