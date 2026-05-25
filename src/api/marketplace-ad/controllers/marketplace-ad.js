'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

function isAdminUser(user) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin';
}

async function getUserWithRole(strapi, userId) {
  if (!userId) return null;
  return strapi.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
}

async function resolveUserWithRole(strapi, ctx) {
  if (ctx.state.user?.id) {
    return getUserWithRole(strapi, ctx.state.user.id);
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.substring(7);
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    return getUserWithRole(strapi, id);
  } catch (_) {
    return null;
  }
}

async function assertAdmin(ctx, strapi) {
  const user = await resolveUserWithRole(strapi, ctx);

  if (!user) {
    ctx.unauthorized('You must be logged in');
    return false;
  }

  if (!isAdminUser(user)) {
    ctx.forbidden('Only admins can manage marketplace ads');
    return false;
  }

  return true;
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMediaUrl(media) {
  const rawUrl = media?.url || media?.data?.attributes?.url || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http')) return rawUrl;
  const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return baseUrl ? `${baseUrl}${rawUrl}` : rawUrl;
}

function normalizeAd(ad) {
  if (!ad) return null;
  return {
    id: ad.documentId || String(ad.id),
    strapiId: ad.id,
    title: ad.title || '',
    subtitle: ad.subtitle || '',
    eyebrow: ad.eyebrow || '',
    ctaLabel: ad.ctaLabel || '',
    linkUrl: ad.linkUrl || '',
    imageUrl: ad.imageUrl || normalizeMediaUrl(ad.image),
    backgroundColor: ad.backgroundColor || '#073f56',
    textColor: ad.textColor || '#ffffff',
    accentColor: ad.accentColor || '#ff8a00',
    placement: ad.placement || 'marketplace_top',
    status: ad.status || 'active',
    priority: Number(ad.priority || 0),
    startsAt: ad.startsAt || null,
    endsAt: ad.endsAt || null,
    createdAt: ad.createdAt || null,
    updatedAt: ad.updatedAt || null,
  };
}

function isAdLive(ad, now = Date.now()) {
  if (!ad || ad.status !== 'active') return false;
  const startsAt = toTimestamp(ad.startsAt);
  const endsAt = toTimestamp(ad.endsAt);
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

function cleanInput(input = {}) {
  return {
    title: String(input.title || '').trim(),
    subtitle: String(input.subtitle || '').trim(),
    eyebrow: String(input.eyebrow || '').trim(),
    ctaLabel: String(input.ctaLabel || '').trim(),
    linkUrl: String(input.linkUrl || '').trim(),
    imageUrl: String(input.imageUrl || '').trim(),
    backgroundColor: String(input.backgroundColor || '#073f56').trim(),
    textColor: String(input.textColor || '#ffffff').trim(),
    accentColor: String(input.accentColor || '#ff8a00').trim(),
    placement: input.placement === 'marketplace_top' ? 'marketplace_top' : 'marketplace_top',
    status: input.status === 'paused' ? 'paused' : 'active',
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
    startsAt: input.startsAt || null,
    endsAt: input.endsAt || null,
  };
}

module.exports = createCoreController('api::marketplace-ad.marketplace-ad', ({ strapi }) => ({
  async active(ctx) {
    const placement = String(ctx.query?.placement || 'marketplace_top');
    const ads = await strapi.documents('api::marketplace-ad.marketplace-ad').findMany({
      filters: {
        placement,
        status: 'active',
      },
      populate: { image: true },
      sort: [{ priority: 'desc' }, { createdAt: 'desc' }],
      limit: 20,
    });

    return {
      data: (ads || [])
        .filter((ad) => isAdLive(ad))
        .map(normalizeAd)
        .filter(Boolean),
    };
  },

  async adminList(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const ads = await strapi.documents('api::marketplace-ad.marketplace-ad').findMany({
      populate: { image: true },
      sort: [{ priority: 'desc' }, { createdAt: 'desc' }],
      limit: 100,
    });

    return { data: (ads || []).map(normalizeAd).filter(Boolean) };
  },

  async adminCreate(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const data = cleanInput(ctx.request.body?.data || ctx.request.body || {});
    if (!data.title) return ctx.badRequest('Ad title is required');

    const created = await strapi.documents('api::marketplace-ad.marketplace-ad').create({
      data,
      populate: { image: true },
    });

    return { data: normalizeAd(created) };
  },

  async adminUpdate(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const documentId = String(ctx.params.id || '').trim();
    if (!documentId) return ctx.badRequest('Missing ad id');

    const updated = await strapi.documents('api::marketplace-ad.marketplace-ad').update({
      documentId,
      data: cleanInput(ctx.request.body?.data || ctx.request.body || {}),
      populate: { image: true },
    });

    return { data: normalizeAd(updated) };
  },

  async adminDelete(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const documentId = String(ctx.params.id || '').trim();
    if (!documentId) return ctx.badRequest('Missing ad id');

    await strapi.documents('api::marketplace-ad.marketplace-ad').delete({ documentId });
    return { data: { success: true } };
  },
}));
