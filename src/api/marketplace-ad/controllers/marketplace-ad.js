'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

function isAdminUser(user) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || user?.isApiTokenAdmin === true;
}

async function getUserWithRole(strapi, userId) {
  if (!userId) return null;
  return strapi.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
}

async function resolveApiTokenAdmin(strapi, token) {
  if (!token) return null;
  try {
    const apiTokenService = strapi.service('admin::api-token');
    if (!apiTokenService?.hash) return null;
    const accessKey = apiTokenService.hash(token);
    const tokenRow = await strapi.db.query('admin::api-token').findOne({ where: { accessKey } });
    if (tokenRow && tokenRow.type === 'full-access') {
      return { isApiTokenAdmin: true };
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function resolveUserWithRole(strapi, ctx) {
  if (ctx.state.user?.id) {
    return getUserWithRole(strapi, ctx.state.user.id);
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  // 1) users-permissions JWT (admin user logging in from the web app)
  try {
    const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    const user = await getUserWithRole(strapi, id);
    if (user) return user;
  } catch (_) {
    // Not a users-permissions JWT — fall through to API token check.
  }

  // 2) full-access Strapi API token (used by maintenance scripts)
  return resolveApiTokenAdmin(strapi, token);
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
  const placement = String(input.placement || 'marketplace_top').trim();
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
    placement: ['marketplace_carousel', 'marketplace_sidebar'].includes(placement) ? placement : 'marketplace_top',
    status: input.status === 'paused' ? 'paused' : 'active',
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
    startsAt: input.startsAt || null,
    endsAt: input.endsAt || null,
  };
}

function fillAdDefaults(data = {}) {
  const placement = ['marketplace_carousel', 'marketplace_sidebar'].includes(data.placement) ? data.placement : 'marketplace_top';
  const title = String(data.title || '').trim() || (placement === 'marketplace_carousel' ? 'Carousel Image' : 'Ad Card');
  return {
    ...data,
    placement,
    title,
  };
}

module.exports = createCoreController('api::marketplace-ad.marketplace-ad', ({ strapi }) => ({
  async active(ctx) {
    const placement = String(ctx.query?.placement || 'marketplace_top');
    const isSidebar = placement === 'marketplace_sidebar';
    const ads = await strapi.documents('api::marketplace-ad.marketplace-ad').findMany({
      filters: {
        placement,
        status: 'active',
      },
      populate: { image: true },
      // Sidebar ad cards rotate through every uploaded image in random order on
      // the client — avoid newest-first bias and fetch the full active set.
      sort: isSidebar ? [{ id: 'asc' }] : [{ priority: 'desc' }, { createdAt: 'desc' }],
      limit: isSidebar ? 200 : 20,
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

    const data = fillAdDefaults(cleanInput(ctx.request.body?.data || ctx.request.body || {}));
    if (!data.imageUrl) return ctx.badRequest('Ad image is required');

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

    const data = fillAdDefaults(cleanInput(ctx.request.body?.data || ctx.request.body || {}));
    if (!data.imageUrl) return ctx.badRequest('Ad image is required');

    const updated = await strapi.documents('api::marketplace-ad.marketplace-ad').update({
      documentId,
      data,
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

  async adminUploadImage(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const fs   = require('node:fs');
    const path = require('node:path');
    const { randomUUID } = require('node:crypto');

    // koa-body puts uploaded files on ctx.request.files; field name is "file"
    const rawFile = ctx.request.files?.file;
    const uploadedFile = Array.isArray(rawFile) ? rawFile[0] : rawFile;

    if (!uploadedFile) {
      return ctx.badRequest('No file provided. Send multipart/form-data with a "file" field.');
    }

    const isBackblaze     = (process.env.STORAGE_PROVIDER || 'backblaze').toLowerCase() === 'backblaze';
    const endpoint        = isBackblaze ? process.env.B2_ENDPOINT     : process.env.CF_ENDPOINT;
    const bucket          = isBackblaze ? process.env.B2_BUCKET        : process.env.CF_BUCKET;
    const publicUrl       = (isBackblaze ? process.env.B2_PUBLIC_URL   : process.env.CF_PUBLIC_URL || '').replace(/\/$/, '');
    const accessKeyId     = isBackblaze ? process.env.B2_ACCESS_KEY_ID : process.env.CF_ACCESS_KEY_ID;
    const secretAccessKey = isBackblaze ? process.env.B2_ACCESS_SECRET : process.env.CF_ACCESS_SECRET;
    const region          = isBackblaze ? (process.env.B2_REGION || 'us-east-005') : 'auto';

    const s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    // Support both formidable v2 (.path / .name / .type) and v3+ (.filepath / .originalFilename / .mimetype)
    const tempPath    = uploadedFile.filepath || uploadedFile.path;
    const origName    = uploadedFile.originalFilename || uploadedFile.name || 'upload';
    const contentType = uploadedFile.mimetype || uploadedFile.type || 'application/octet-stream';

    const rawBuffer = fs.readFileSync(tempPath);

    // Compress/resize ad images to keep the marketplace carousel fast. Banner
    // creatives only need to render up to ~1600px wide, so we never serve the
    // multi-MB originals that sellers/admins tend to upload.
    let body = rawBuffer;
    let key = `marketplace-ads/${randomUUID()}${path.extname(origName).toLowerCase() || '.jpg'}`;
    let outputType = contentType;

    if (String(contentType).startsWith('image/')) {
      try {
        const sharp = require('sharp');
        body = await sharp(rawBuffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        key = `marketplace-ads/${randomUUID()}.webp`;
        outputType = 'image/webp';
      } catch (error) {
        strapi.log.warn(`[marketplace-ads] Image compression failed, uploading original: ${error.message}`);
        body = rawBuffer;
      }
    }

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: outputType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return ctx.send({ url: `${publicUrl}/${key}` });
  },
}));
