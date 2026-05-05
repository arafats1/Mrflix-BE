'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const RELIGION_OPTIONS = ['Catholic', 'Protestant', 'Pentecostal', 'Adventist', 'Orthodox', 'Muslim', 'Hindu', 'Bahai', 'Traditional', 'Other'];
const EDUCATION_LEVEL_OPTIONS = ['Kindergarten', 'Primary', 'Secondary', 'Technical college', 'University', 'Other'];
const AGE_RANGE_OPTIONS = ['ages_0_4', 'ages_5_8', 'ages_9_12', 'ages_13_17', 'all_ages'];
const MEDIA_TYPE_OPTIONS = ['pdf', 'video', 'audio'];

function normalizeClassLabels(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function pickMediaId(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number.parseInt(value, 10) || undefined;
  if (typeof value === 'object' && value !== null) {
    if (typeof value.id === 'number') return value.id;
    if (typeof value.data?.id === 'number') return value.data.id;
  }
  return undefined;
}

function inferPrimaryMediaType({ pdfPresent, audioPresent, videoPresent, fallbackMediaType }) {
  if (pdfPresent) return 'pdf';
  if (videoPresent) return 'video';
  if (audioPresent) return 'audio';
  if (MEDIA_TYPE_OPTIONS.includes(fallbackMediaType)) return fallbackMediaType;
  return null;
}

function pickUrl(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

async function getFullUser(strapi, userId) {
  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'username', 'accountType', 'providerType', 'schoolName', 'educationLevel', 'educationLevelOther', 'religion'],
  });
}

function sanitizeMaterialInput(body = {}, provider) {
  const providerType = provider?.providerType;
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const priceUGX = Math.max(0, Number.parseInt(body.priceUGX, 10) || 0);
  const classLabels = normalizeClassLabels(body.classLabels);
  const educationLevel = EDUCATION_LEVEL_OPTIONS.includes(body.educationLevel) ? body.educationLevel : provider?.educationLevel || null;
  const educationLevelOther = String(body.educationLevelOther || provider?.educationLevelOther || '').trim();
  const schoolName = String(body.schoolName || provider?.schoolName || '').trim();
  const religion = RELIGION_OPTIONS.includes(body.religion) ? body.religion : provider?.religion || null;
  const ageRange = AGE_RANGE_OPTIONS.includes(body.ageRange) ? body.ageRange : 'all_ages';
  const subject = body.subject || null;
  const course = body.course || null;
  const legacyAttachment = pickMediaId(body.attachment);
  const fallbackMediaType = MEDIA_TYPE_OPTIONS.includes(body.mediaType) ? body.mediaType : null;
  const pdfAttachmentInput = pickMediaId(body.pdfAttachment);
  const audioAttachmentInput = pickMediaId(body.audioAttachment);
  const videoAttachmentInput = pickMediaId(body.videoAttachment);
  const pdfAttachment = pdfAttachmentInput !== undefined
    ? pdfAttachmentInput
    : fallbackMediaType === 'pdf'
      ? legacyAttachment
      : undefined;
  const audioAttachment = audioAttachmentInput !== undefined
    ? audioAttachmentInput
    : fallbackMediaType === 'audio'
      ? legacyAttachment
      : undefined;
  const videoAttachment = videoAttachmentInput !== undefined
    ? videoAttachmentInput
    : fallbackMediaType === 'video'
      ? legacyAttachment
      : undefined;

  // Backblaze direct-upload URL fields (preferred)
  const pdfUrl = pickUrl(body.pdfUrl);
  const audioUrl = pickUrl(body.audioUrl);
  const videoUrl = pickUrl(body.videoUrl);
  const thumbnailUrl = pickUrl(body.thumbnailUrl);
  const pdfKey = pickUrl(body.pdfKey);
  const audioKey = pickUrl(body.audioKey);
  const videoKey = pickUrl(body.videoKey);
  const thumbnailKey = pickUrl(body.thumbnailKey);

  const pdfPresent = !!(pdfUrl || pdfAttachment);
  const audioPresent = !!(audioUrl || audioAttachment);
  const videoPresent = !!(videoUrl || videoAttachment);

  const mediaType = inferPrimaryMediaType({ pdfPresent, audioPresent, videoPresent, fallbackMediaType });
  const attachment = mediaType === 'pdf'
    ? pdfAttachment
    : mediaType === 'audio'
      ? audioAttachment
      : mediaType === 'video'
        ? videoAttachment
        : null;
  const thumbnail = body.thumbnail || null;
  const status = ['draft', 'published', 'rejected'].includes(body.status) ? body.status : 'draft';

  if (!title) {
    const err = new Error('Title is required');
    err.status = 400;
    throw err;
  }
  if (!mediaType) {
    const err = new Error('Upload at least one material file');
    err.status = 400;
    throw err;
  }
  if (!attachment && !pdfUrl && !audioUrl && !videoUrl) {
    const err = new Error('Upload at least one material file');
    err.status = 400;
    throw err;
  }

  if (providerType === 'teacher') {
    if (!educationLevel) {
      const err = new Error('Education level is required for teacher materials');
      err.status = 400;
      throw err;
    }
    if (educationLevel === 'Other' && !educationLevelOther) {
      const err = new Error('Provide the custom education level when selecting Other');
      err.status = 400;
      throw err;
    }
    if (!subject) {
      const err = new Error('Select a subject for teacher materials');
      err.status = 400;
      throw err;
    }
    if (classLabels.length === 0 && !course) {
      const err = new Error('Select at least one class or course for teacher materials');
      err.status = 400;
      throw err;
    }
  }

  if (providerType === 'religious' && !religion) {
    const err = new Error('Religion is required for religious materials');
    err.status = 400;
    throw err;
  }

  return {
    title,
    description,
    providerType,
    contentCategory: providerType === 'religious' ? 'religion' : 'education',
    schoolName: schoolName || null,
    educationLevel,
    educationLevelOther: educationLevel === 'Other' ? educationLevelOther : null,
    classLabels,
    religion,
    ageRange,
    priceUGX,
    mediaType,
    attachment,
    pdfAttachment: pdfAttachment || null,
    audioAttachment: audioAttachment || null,
    videoAttachment: videoAttachment || null,
    thumbnail: thumbnail || null,
    pdfUrl: pdfUrl || null,
    audioUrl: audioUrl || null,
    videoUrl: videoUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    pdfKey: pdfKey || null,
    audioKey: audioKey || null,
    videoKey: videoKey || null,
    thumbnailKey: thumbnailKey || null,
    status,
    provider: provider.id,
    subject: subject || null,
    course: course || null,
  };
}

module.exports = createCoreController('api::provider-material.provider-material', ({ strapi }) => ({
  async find(ctx) {
    const filters = { status: 'published' };
    if (ctx.query.providerType) filters.providerType = ctx.query.providerType;
    if (ctx.query.contentCategory) filters.contentCategory = ctx.query.contentCategory;

    const materials = await strapi.documents('api::provider-material.provider-material').findMany({
      filters,
      populate: {
        provider: true,
        subject: true,
        course: true,
        attachment: true,
        pdfAttachment: true,
        audioAttachment: true,
        videoAttachment: true,
        thumbnail: true,
      },
      sort: ['createdAt:desc'],
    });

    ctx.body = { data: materials };
  },

  async findOne(ctx) {
    const material = await strapi.documents('api::provider-material.provider-material').findOne({
      documentId: ctx.params.id,
      populate: {
        provider: true,
        subject: true,
        course: true,
        attachment: true,
        pdfAttachment: true,
        audioAttachment: true,
        videoAttachment: true,
        thumbnail: true,
      },
    });

    if (!material || material.status !== 'published') return ctx.notFound('Material not found');
    ctx.body = { data: material };
  },

  async mine(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();

    const provider = await getFullUser(strapi, ctx.state.user.id);
    if (!provider || provider.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can access provider materials');
    }

    const materials = await strapi.documents('api::provider-material.provider-material').findMany({
      filters: { provider: { id: provider.id } },
      populate: {
        subject: true,
        course: true,
        attachment: true,
        pdfAttachment: true,
        audioAttachment: true,
        videoAttachment: true,
        thumbnail: true,
      },
      sort: ['createdAt:desc'],
    });

    ctx.body = { data: materials };
  },

  async summary(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();

    const provider = await getFullUser(strapi, ctx.state.user.id);
    if (!provider || provider.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can access provider summaries');
    }

    const materials = await strapi.documents('api::provider-material.provider-material').findMany({
      filters: { provider: { id: provider.id } },
      fields: ['priceUGX', 'totalSales', 'totalRevenueUGX', 'status'],
    });

    const summary = (materials || []).reduce(
      (acc, item) => {
        acc.materials += 1;
        acc.totalSales += Number(item.totalSales || 0);
        acc.totalRevenueUGX += Number(item.totalRevenueUGX || 0);
        if (item.status === 'published') acc.published += 1;
        if (item.status === 'draft') acc.drafts += 1;
        return acc;
      },
      { materials: 0, totalSales: 0, totalRevenueUGX: 0, published: 0, drafts: 0 }
    );

    ctx.body = { data: summary };
  },

  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();

    const provider = await getFullUser(strapi, ctx.state.user.id);
    if (!provider || provider.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can upload materials');
    }

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    try {
      const data = sanitizeMaterialInput(body, provider);
      const created = await strapi.documents('api::provider-material.provider-material').create({
        data,
        populate: {
          subject: true,
          course: true,
          attachment: true,
          pdfAttachment: true,
          audioAttachment: true,
          videoAttachment: true,
          thumbnail: true,
        },
      });
      ctx.body = { data: created };
    } catch (err) {
      return ctx.badRequest(err.message || 'Failed to create provider material');
    }
  },

  async update(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    const provider = await getFullUser(strapi, ctx.state.user.id);
    if (!provider || provider.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can update materials');
    }

    const existing = await strapi.documents('api::provider-material.provider-material').findOne({
      documentId: ctx.params.id,
      populate: { provider: { fields: ['id'] } },
    });
    if (!existing) return ctx.notFound('Material not found');
    if (existing.provider?.id !== provider.id) return ctx.forbidden('You can only update your own materials');

    const body = (ctx.request.body && ctx.request.body.data) || ctx.request.body || {};
    try {
      const data = sanitizeMaterialInput({ ...existing, ...body }, provider);
      const updated = await strapi.documents('api::provider-material.provider-material').update({
        documentId: ctx.params.id,
        data,
        populate: {
          subject: true,
          course: true,
          attachment: true,
          pdfAttachment: true,
          audioAttachment: true,
          videoAttachment: true,
          thumbnail: true,
        },
      });
      ctx.body = { data: updated };
    } catch (err) {
      return ctx.badRequest(err.message || 'Failed to update provider material');
    }
  },

  async delete(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    const provider = await getFullUser(strapi, ctx.state.user.id);
    if (!provider || provider.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can delete materials');
    }

    const existing = await strapi.documents('api::provider-material.provider-material').findOne({
      documentId: ctx.params.id,
      populate: { provider: { fields: ['id'] } },
    });
    if (!existing) return ctx.notFound('Material not found');
    if (existing.provider?.id !== provider.id) return ctx.forbidden('You can only delete your own materials');

    await strapi.documents('api::provider-material.provider-material').delete({
      documentId: ctx.params.id,
    });

    ctx.body = { data: { documentId: ctx.params.id, deleted: true } };
  },
}));