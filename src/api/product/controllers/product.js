'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { scheduleProductImageProcessing, processProductImages } = require('../../../utils/marketplace-image-processing');
const { assertAdmin } = require('../../../utils/admin-auth');
const { resolveAuthUser } = require('../../../utils/resolve-auth-user');
const { isCarCategory, carProductFilters, calculateHirePurchaseMonthly } = require('../../../utils/cars');

async function requireAuthUser(strapi, ctx) {
  const user = await resolveAuthUser(strapi, ctx);
  if (!user) return null;
  ctx.state.user = user;
  return user;
}

function normalizeDeliveryAreas(input = []) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,]+/)
      : [];

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeServiceDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';

  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : normalized;
}

function normalizeServiceDateList(input = []) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,]+/)
      : [];

  return [...new Set(values.map(normalizeServiceDate).filter(Boolean))].sort();
}

function normalizeProductVideoComments(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((comment) => ({
      id: String(comment?.id || '').trim() || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: String(comment?.text || '').trim().slice(0, 500),
      authorName: String(comment?.authorName || 'Buyer').trim().slice(0, 80),
      authorId: comment?.authorId ? String(comment.authorId) : '',
      createdAt: comment?.createdAt || new Date().toISOString(),
    }))
    .filter((comment) => comment.text)
    .slice(-100);
}

function withSellerPaymentFallback(product) {
  if (!product) return product;

  return {
    ...product,
    deliveryAreas: normalizeDeliveryAreas(product.deliveryAreas),
    serviceAvailabilityDates: product.itemType === 'service'
      ? normalizeServiceDateList(product.serviceAvailabilityDates)
      : [],
    serviceBookedDates: product.itemType === 'service'
      ? normalizeServiceDateList(product.serviceBookedDates)
      : [],
    paymentPhone: product.paymentPhone || product.seller?.paymentPhone || null,
    paymentCode: product.paymentCode || product.seller?.paymentCode || null,
    hirePurchaseTerms: product.hirePurchaseTerms || product.seller?.hirePurchaseTerms || null,
    hirePurchaseDepositPercent: product.hirePurchaseDepositPercent || product.seller?.hirePurchaseDepositPercent || null,
    showCarMonthlyPayment: Boolean(
      product.showCarMonthlyPayment
      ?? product.seller?.showCarMonthlyPayment
    ),
    hirePurchaseMonthlyUGX: Boolean(product.showCarMonthlyPayment ?? product.seller?.showCarMonthlyPayment)
      ? calculateHirePurchaseMonthly(
        product.priceUGX,
        product.hirePurchaseDepositPercent || product.seller?.hirePurchaseDepositPercent,
      )
      : null,
    itemType: product.itemType === 'service' ? 'service' : 'product',
    marketplaceSource: product.marketplaceSource || 'core',
    promotedUntil: product.promotedUntil || null,
    promotionKind: product.promotionKind || null,
    promotionBadgeLabel: product.promotionBadgeLabel || null,
    productVideoLikes: Math.max(0, Number(product.productVideoLikes || 0)),
    productVideoComments: normalizeProductVideoComments(product.productVideoComments),
  };
}

function normalizeHirePurchaseTerms(value) {
  return String(value || '').trim().slice(0, 5000) || null;
}

function normalizeDepositPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

async function getSellerHirePurchaseTerms(strapi, user) {
  const fromUser = normalizeHirePurchaseTerms(user?.hirePurchaseTerms);
  if (fromUser) return fromUser;

  const existing = await strapi.db.query('api::product.product').findOne({
    where: {
      seller: { id: user.id },
      ...carProductFilters(),
      hirePurchaseTerms: { $notNull: true },
    },
    select: ['hirePurchaseTerms'],
    orderBy: { updatedAt: 'desc' },
  }).catch(() => null);

  return normalizeHirePurchaseTerms(existing?.hirePurchaseTerms);
}

async function getSellerHirePurchaseDeposit(strapi, user) {
  const fromUser = normalizeDepositPercent(user?.hirePurchaseDepositPercent);
  if (fromUser) return fromUser;

  const existing = await strapi.db.query('api::product.product').findOne({
    where: {
      seller: { id: user.id },
      ...carProductFilters(),
      hirePurchaseDepositPercent: { $gt: 0 },
    },
    select: ['hirePurchaseDepositPercent'],
    orderBy: { updatedAt: 'desc' },
  }).catch(() => null);

  return normalizeDepositPercent(existing?.hirePurchaseDepositPercent);
}

function normalizeBool(value) {
  if (value === true || value === 'yes' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'no' || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

async function getSellerShowCarMonthly(strapi, user) {
  if (typeof user?.showCarMonthlyPayment === 'boolean') return user.showCarMonthlyPayment;
  const existing = await strapi.db.query('api::product.product').findOne({
    where: {
      seller: { id: user.id },
      ...carProductFilters(),
      showCarMonthlyPayment: true,
    },
    select: ['showCarMonthlyPayment'],
  }).catch(() => null);
  return Boolean(existing?.showCarMonthlyPayment);
}

async function syncSellerHirePurchaseDefaults(strapi, userId, patch = {}) {
  const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['hirePurchaseTerms', 'hirePurchaseDepositPercent', 'showCarMonthlyPayment'],
  }).catch(() => null);

  const nextTerms = Object.prototype.hasOwnProperty.call(patch, 'terms')
    ? normalizeHirePurchaseTerms(patch.terms)
    : normalizeHirePurchaseTerms(currentUser?.hirePurchaseTerms);
  const nextDeposit = Object.prototype.hasOwnProperty.call(patch, 'depositPercent')
    ? normalizeDepositPercent(patch.depositPercent)
    : normalizeDepositPercent(currentUser?.hirePurchaseDepositPercent);
  const nextShowMonthly = Object.prototype.hasOwnProperty.call(patch, 'showMonthly')
    ? Boolean(patch.showMonthly)
    : Boolean(currentUser?.showCarMonthlyPayment);

  const termsChanged = nextTerms !== normalizeHirePurchaseTerms(currentUser?.hirePurchaseTerms);
  const depositChanged = nextDeposit !== normalizeDepositPercent(currentUser?.hirePurchaseDepositPercent);
  const showChanged = nextShowMonthly !== Boolean(currentUser?.showCarMonthlyPayment);

  if (termsChanged || depositChanged || showChanged) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: {
        ...(termsChanged ? { hirePurchaseTerms: nextTerms } : {}),
        ...(depositChanged ? { hirePurchaseDepositPercent: nextDeposit } : {}),
        ...(showChanged ? { showCarMonthlyPayment: nextShowMonthly } : {}),
      },
    });
  }

  if (termsChanged || depositChanged || showChanged) {
    const cars = await strapi.documents('api::product.product').findMany({
      filters: {
        seller: { id: userId },
        ...carProductFilters(),
      },
      fields: ['documentId', 'priceUGX'],
      status: 'published',
      limit: 500,
    }).catch(() => []);

    await Promise.all((cars || []).map((car) => (
      strapi.documents('api::product.product').update({
        documentId: car.documentId,
        data: {
          hirePurchaseTerms: nextTerms,
          hirePurchaseDepositPercent: nextDeposit,
          showCarMonthlyPayment: nextShowMonthly,
          hirePurchaseMonthlyUGX: nextShowMonthly ? calculateHirePurchaseMonthly(car.priceUGX, nextDeposit) : null,
        },
        status: 'published',
      }).catch(() => null)
    )));
  }

  return { terms: nextTerms, depositPercent: nextDeposit, showMonthly: nextShowMonthly };
}

async function applySellerHirePurchaseSettings(strapi, user, product, input = {}) {
  if (!product || !user) return product;
  const category = input.category || product.category;
  if (!isCarCategory(category)) return product;

  const hasTerms = Object.prototype.hasOwnProperty.call(input, 'hirePurchaseTerms');
  const hasDeposit = Object.prototype.hasOwnProperty.call(input, 'hirePurchaseDepositPercent');
  const hasShowMonthly = Object.prototype.hasOwnProperty.call(input, 'showCarMonthlyPayment');

  if (hasTerms || hasDeposit || hasShowMonthly) {
    const synced = await syncSellerHirePurchaseDefaults(strapi, user.id, {
      ...(hasTerms ? { terms: input.hirePurchaseTerms } : {}),
      ...(hasDeposit ? { depositPercent: input.hirePurchaseDepositPercent } : {}),
      ...(hasShowMonthly ? { showMonthly: normalizeBool(input.showCarMonthlyPayment) } : {}),
    });
    const monthly = synced.showMonthly ? calculateHirePurchaseMonthly(product.priceUGX, synced.depositPercent) : null;
    await strapi.db.query('api::product.product').update({
      where: { id: product.id },
      data: {
        hirePurchaseDepositPercent: synced.depositPercent,
        hirePurchaseMonthlyUGX: monthly,
        hirePurchaseTerms: synced.terms,
        showCarMonthlyPayment: synced.showMonthly,
      },
    }).catch(() => null);
    return {
      ...product,
      hirePurchaseTerms: synced.terms,
      hirePurchaseDepositPercent: synced.depositPercent,
      hirePurchaseMonthlyUGX: monthly,
      showCarMonthlyPayment: synced.showMonthly,
    };
  }

  const sellerTerms = await getSellerHirePurchaseTerms(strapi, user);
  const sellerDeposit = await getSellerHirePurchaseDeposit(strapi, user);
  const showMonthly = await getSellerShowCarMonthly(strapi, user);
  const monthly = showMonthly ? calculateHirePurchaseMonthly(product.priceUGX, sellerDeposit) : null;

  await strapi.db.query('api::product.product').update({
    where: { id: product.id },
    data: {
      ...(sellerTerms ? { hirePurchaseTerms: sellerTerms } : {}),
      ...(sellerDeposit != null ? { hirePurchaseDepositPercent: sellerDeposit } : {}),
      showCarMonthlyPayment: showMonthly,
      hirePurchaseMonthlyUGX: monthly,
    },
  }).catch(() => null);

  return {
    ...product,
    hirePurchaseTerms: sellerTerms || product.hirePurchaseTerms,
    hirePurchaseDepositPercent: sellerDeposit ?? product.hirePurchaseDepositPercent,
    hirePurchaseMonthlyUGX: monthly,
    showCarMonthlyPayment: showMonthly,
  };
}

function normalizeMarketplaceSource(value) {
  return value === 'entrepreneur' ? 'entrepreneur' : 'core';
}

function normalizeItemType(value) {
  return value === 'service' ? 'service' : 'product';
}

function parsePositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Keep this in sync with slugifySellerName() on the web client so the seller
// catalog page (/marketplace/seller/{slug}) resolves to the same slug.
function slugifySellerName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '');
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function clearExpiredProductPromotions(strapi) {
  const now = new Date().toISOString();
  await strapi.db.query('api::product.product').updateMany({
    where: {
      promotedUntil: { $lt: now },
    },
    data: {
      promotedUntil: null,
      promotionKind: null,
      promotionBadgeLabel: null,
    },
  }).catch((error) => {
    strapi.log.warn(`Failed to clear expired product promotions: ${error.message}`);
  });
}

async function getEntrepreneurProfileForUser(strapi, userId) {
  if (!userId) return null;

  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId },
    limit: 1,
  });

  return profiles?.[0] || null;
}

async function enrichSellerIdentity(strapi, product) {
  if (!product?.seller?.id) return product;

  const entrepreneurProfile = await getEntrepreneurProfileForUser(strapi, product.seller.id);
  const sellerDisplayName = entrepreneurProfile?.fullName || product.seller?.fullName || product.seller?.shopName || product.seller?.username || product.seller?.email || null;
  const sellerLocation = entrepreneurProfile?.location || product.seller?.location || null;
  const sellerPhone = entrepreneurProfile?.phone || product.paymentPhone || product.seller?.phone || product.seller?.paymentPhone || null;
  const sellerAge = entrepreneurProfile?.age || null;
  const sellerProfilePhotoUrl = entrepreneurProfile?.profilePhotoUrl || product.seller?.avatarUrl || null;

  return {
    ...product,
    sellerDisplayName,
    sellerLocation,
    sellerPhone,
    sellerAge,
    sellerProfilePhotoUrl,
  };
}

async function withSoldCount(strapi, product) {
  if (!product) return product;

  const soldCount = await strapi.db.query('api::purchase.purchase').count({
    where: {
      product: { id: product.id },
      status: { $ne: 'failed' },
    },
  });

  return {
    ...(await enrichSellerIdentity(strapi, withSellerPaymentFallback(product))),
    soldCount,
  };
}

/**
 * Batched equivalent of mapping `enrichSellerIdentity` over a list. Resolves
 * every seller's entrepreneur profile in a single query instead of one query
 * per product (removes an N+1 on the marketplace listing endpoint).
 */
async function enrichSellerIdentities(strapi, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : [products].filter(Boolean);
  if (!list.length) return Array.isArray(products) ? [] : null;

  const sellerIds = [...new Set(list.map((product) => product.seller?.id).filter(Boolean))];
  const profileByUserId = new Map();

  if (sellerIds.length) {
    const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: { user: { id: { $in: sellerIds } } },
      populate: { user: true },
      limit: sellerIds.length,
    }).catch((error) => {
      strapi.log.warn(`Batched seller profile lookup failed: ${error.message}`);
      return [];
    });

    for (const profile of profiles || []) {
      const userId = profile?.user?.id;
      if (userId) profileByUserId.set(userId, profile);
    }
  }

  const enriched = list.map((product) => {
    if (!product?.seller?.id) return product;
    const entrepreneurProfile = profileByUserId.get(product.seller.id) || null;

    return {
      ...product,
      sellerDisplayName: entrepreneurProfile?.fullName || product.seller?.fullName || product.seller?.shopName || product.seller?.username || product.seller?.email || null,
      sellerLocation: entrepreneurProfile?.location || product.seller?.location || null,
      sellerPhone: entrepreneurProfile?.phone || product.paymentPhone || product.seller?.phone || product.seller?.paymentPhone || null,
      sellerAge: entrepreneurProfile?.age || null,
      sellerProfilePhotoUrl: entrepreneurProfile?.profilePhotoUrl || product.seller?.avatarUrl || null,
    };
  });

  return Array.isArray(products) ? enriched : enriched[0];
}

/**
 * Batched equivalent of mapping `withSoldCount` over a list. Computes every
 * product's non-failed purchase count in a single grouped query instead of one
 * count query per product. Falls back to per-product counts if the grouped
 * query fails (e.g. unexpected link-table name on a future Strapi version).
 */
async function attachSoldCounts(strapi, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : [products].filter(Boolean);
  if (!list.length) return Array.isArray(products) ? [] : null;

  const ids = [...new Set(list.map((product) => product.id).filter(Boolean))];
  const countByProductId = new Map();

  if (ids.length) {
    try {
      const rows = await strapi.db.connection('purchases_product_lnk as lnk')
        .join('purchases as p', 'p.id', 'lnk.purchase_id')
        .whereIn('lnk.product_id', ids)
        .andWhere('p.status', '<>', 'failed')
        .groupBy('lnk.product_id')
        .select('lnk.product_id as productId')
        .count('p.id as soldCount');

      for (const row of rows || []) {
        countByProductId.set(Number(row.productId), Number(row.soldCount || 0));
      }
    } catch (error) {
      strapi.log.warn(`Batched sold-count query failed, falling back to per-product counts: ${error.message}`);
      await Promise.all(ids.map(async (id) => {
        const soldCount = await strapi.db.query('api::purchase.purchase').count({
          where: { product: { id }, status: { $ne: 'failed' } },
        }).catch(() => 0);
        countByProductId.set(Number(id), Number(soldCount || 0));
      }));
    }
  }

  const enriched = list.map((product) => ({
    ...product,
    soldCount: countByProductId.get(Number(product.id)) || 0,
  }));

  return Array.isArray(products) ? enriched : enriched[0];
}

async function attachReviewSummary(strapi, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : [products].filter(Boolean);
  if (!list.length) return Array.isArray(products) ? [] : null;

  const productIds = [...new Set(list.map((product) => String(product.documentId || product.id || '')).filter(Boolean))];
  if (!productIds.length) return Array.isArray(products) ? list : list[0];

  const reviews = await strapi.documents('api::product-review.product-review').findMany({
    filters: {
      productId: { $in: productIds },
      status: 'approved',
    },
    status: 'published',
  }).catch(() => []);

  const summaryByProductId = reviews.reduce((acc, review) => {
    const key = String(review.productId || '').trim();
    if (!key) return acc;
    acc[key] = acc[key] || { total: 0, count: 0 };
    acc[key].total += Number(review.rating || 0);
    acc[key].count += 1;
    return acc;
  }, {});

  const enriched = list.map((product) => {
    const key = String(product.documentId || product.id || '').trim();
    const summary = summaryByProductId[key] || { total: 0, count: 0 };
    const average = summary.count > 0 ? Math.round((summary.total / summary.count) * 10) / 10 : 0;

    return {
      ...product,
      rating: average,
      reviewsCount: summary.count,
    };
  });

  return Array.isArray(products) ? enriched : enriched[0];
}

async function attachActivePromotionState(strapi, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : [products].filter(Boolean);
  if (!list.length) return Array.isArray(products) ? [] : null;

  const productDocumentIds = [...new Set(list.map((product) => product.documentId).filter(Boolean))];
  const sellerIds = [...new Set(list.map((product) => product.seller?.id).filter(Boolean))];

  if (!productDocumentIds.length && !sellerIds.length) return Array.isArray(products) ? list : list[0];

  const promotions = await strapi.db.connection('marketplace_promotions as mp')
    .leftJoin('marketplace_promotions_product_lnk as product_lnk', 'product_lnk.marketplace_promotion_id', 'mp.id')
    .leftJoin('products as promoted_product', 'promoted_product.id', 'product_lnk.product_id')
    .leftJoin('marketplace_promotions_seller_lnk as seller_lnk', 'seller_lnk.marketplace_promotion_id', 'mp.id')
    .where('mp.status', 'active')
    .select(
      'mp.id',
      'mp.promotion_type as promotionType',
      'mp.end_date as endDate',
      'promoted_product.document_id as productDocumentId',
      'seller_lnk.user_id as sellerId'
    )
    .limit(1000)
    .catch((error) => {
    strapi.log.warn(`Failed to attach active product promotions: ${error.message}`);
    return [];
  });

  const activeProductPromotions = new Map();
  const activeSellerPromotions = new Map();
  const productDocumentIdSet = new Set(productDocumentIds);
  const sellerIdSet = new Set(sellerIds.map((id) => String(id)));

  for (const promotion of promotions || []) {
    const endTs = toTimestamp(promotion.endDate);
    if (!endTs || endTs <= Date.now()) continue;

    if (promotion.promotionType === 'seller' && promotion.sellerId) {
      if (!sellerIdSet.has(String(promotion.sellerId))) continue;
      const current = activeSellerPromotions.get(promotion.sellerId);
      if (!current || toTimestamp(current.endDate) < endTs) {
        activeSellerPromotions.set(promotion.sellerId, promotion);
      }
      continue;
    }

    const documentId = promotion.productDocumentId;
    if (documentId) {
      if (!productDocumentIdSet.has(documentId)) continue;
      const current = activeProductPromotions.get(documentId);
      if (!current || toTimestamp(current.endDate) < endTs) {
        activeProductPromotions.set(documentId, promotion);
      }
    }
  }

  const enriched = list.map((product) => {
    const sellerPromotion = product.seller?.id ? activeSellerPromotions.get(product.seller.id) : null;
    const productPromotion = product.documentId ? activeProductPromotions.get(product.documentId) : null;
    const winningPromotion = sellerPromotion || productPromotion;

    if (!winningPromotion) return product;

    return {
      ...product,
      promotedUntil: winningPromotion.endDate,
      promotionKind: winningPromotion.promotionType === 'seller' ? 'seller' : 'product',
      promotionBadgeLabel: 'Promoted',
    };
  });

  return Array.isArray(products) ? enriched : enriched[0];
}

function sanitizeProductIdentifier(value) {
  return decodeURIComponent(String(value || '')).trim().split(/\s+/)[0] || '';
}

async function findProductByIdentifier(strapi, id) {
  const normalizedId = sanitizeProductIdentifier(id);

  if (!normalizedId) return null;

  if (/^\d+$/.test(normalizedId)) {
    return strapi.entityService.findOne('api::product.product', normalizedId, {
      populate: {
        seller: true,
      },
    });
  }

  const products = await strapi.documents('api::product.product').findMany({
    filters: {
      documentId: normalizedId,
    },
    populate: {
      seller: true,
    },
    limit: 1,
    status: 'published',
  });

  return products?.[0] || null;
}

function getDiscountedProductAmount(product) {
  const basePrice = Number(product?.priceUGX || 0);
  const discountPercent = Math.min(100, Math.max(0, Number(product?.discountPercent || 0)));

  if (discountPercent <= 0) {
    return basePrice;
  }

  const savings = Math.round(basePrice * (discountPercent / 100));
  return Math.max(basePrice - savings, 0);
}

function canManageProduct(ctx, product) {
  if (!ctx.state.user?.id || !product?.seller?.id) return false;
  return product.seller.id === ctx.state.user.id;
}

function resolveListingStatus(input = {}, existingProduct = null) {
  if (input.status === 'draft') return 'draft';
  if (input.status === 'active') return 'active';
  if (input.status === 'out_of_stock' || input.status === 'discontinued') return input.status;
  if (existingProduct?.status === 'draft') return 'active';
  return existingProduct?.status || 'active';
}

function applyDraftDefaults(payload = {}, input = {}, existingProduct = null) {
  const fallbackName = String(
    payload.name
    ?? input.name
    ?? existingProduct?.name
    ?? ''
  ).trim();

  const images = Array.isArray(payload.images)
    ? payload.images
    : (Array.isArray(existingProduct?.images) ? existingProduct.images : []);

  const featuredImage = String(
    payload.featuredImage
    ?? input.featuredImage
    ?? input.productVideoThumbnailUrl
    ?? input.productVideoUrl
    ?? existingProduct?.featuredImage
    ?? images[0]?.original
    ?? images[0]
    ?? ''
  ).trim();

  return {
    ...payload,
    status: 'draft',
    name: fallbackName || 'Untitled listing',
    description: String(payload.description ?? input.description ?? existingProduct?.description ?? '').trim(),
    priceUGX: Math.max(0, Number(payload.priceUGX ?? input.priceUGX ?? existingProduct?.priceUGX ?? 0) || 0),
    category: String(payload.category ?? input.category ?? existingProduct?.category ?? 'Other').trim() || 'Other',
    stockQuantity: Math.max(0, Number(
      payload.stockQuantity ?? input.stockQuantity ?? existingProduct?.stockQuantity ?? 1
    ) || 0),
    images,
    featuredImage,
    ...(Object.prototype.hasOwnProperty.call(input, 'draftMeta')
      ? { draftMeta: input.draftMeta }
      : existingProduct?.draftMeta
        ? { draftMeta: existingProduct.draftMeta }
        : {}),
  };
}

function validateProductForPublish(payload = {}, existingProduct = null) {
  const errors = [];
  const name = String(payload.name ?? existingProduct?.name ?? '').trim();
  const description = String(payload.description ?? existingProduct?.description ?? '').trim();
  const category = String(payload.category ?? existingProduct?.category ?? '').trim();
  const priceUGX = Number(payload.priceUGX ?? existingProduct?.priceUGX ?? 0);
  const images = Array.isArray(payload.images)
    ? payload.images
    : (Array.isArray(existingProduct?.images) ? existingProduct.images : []);
  const featuredImage = String(payload.featuredImage ?? existingProduct?.featuredImage ?? '').trim();
  const productVideoUrl = String(payload.productVideoUrl ?? existingProduct?.productVideoUrl ?? '').trim();
  const itemType = payload.itemType ?? existingProduct?.itemType ?? 'product';

  if (!name) errors.push('Name is required');
  if (!description) errors.push('Description is required');
  if (!category) errors.push('Category is required');
  if (!Number.isFinite(priceUGX) || priceUGX <= 0) errors.push('Valid price is required');

  const hasImages = images.length > 0;
  const hasVideo = Boolean(productVideoUrl);
  if (!hasImages && !hasVideo) errors.push('At least one image or video is required');
  if (!featuredImage && !hasVideo) errors.push('Featured image is required');

  if (itemType !== 'service') {
    const stockQuantity = Number(payload.stockQuantity ?? existingProduct?.stockQuantity ?? 0);
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      errors.push('Stock quantity is required');
    }
  }

  return errors;
}

function finalizeProductWritePayload(input = {}, existingProduct = null) {
  const listingStatus = resolveListingStatus(input, existingProduct);
  const payload = buildProductPayload(input, existingProduct);

  if (listingStatus === 'draft') {
    return applyDraftDefaults(payload, input, existingProduct);
  }

  const errors = validateProductForPublish(payload, existingProduct);
  if (errors.length) {
    const error = new Error(errors.join('. '));
    error.name = 'ValidationError';
    throw error;
  }

  return {
    ...payload,
    status: listingStatus === 'out_of_stock' || listingStatus === 'discontinued'
      ? listingStatus
      : 'active',
  };
}

function optionalEnum(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function optionalString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function buildProductPayload(input = {}, existingProduct = null) {
  const nextItemType = Object.prototype.hasOwnProperty.call(input, 'itemType')
    ? normalizeItemType(input.itemType)
    : normalizeItemType(existingProduct?.itemType);
  const resolvedFeaturedImage = String(
    input.featuredImage
    || input.productVideoThumbnailUrl
    || input.productVideoUrl
    || existingProduct?.featuredImage
    || ''
  ).trim();

  const nextBookedDates = nextItemType === 'service'
    ? normalizeServiceDateList(
        Object.prototype.hasOwnProperty.call(input, 'serviceBookedDates')
          ? input.serviceBookedDates
          : existingProduct?.serviceBookedDates
      )
    : [];

  const nextAvailabilityDates = nextItemType === 'service'
    ? normalizeServiceDateList(
        Object.prototype.hasOwnProperty.call(input, 'serviceAvailabilityDates')
          ? input.serviceAvailabilityDates
          : existingProduct?.serviceAvailabilityDates
      ).filter((date) => !nextBookedDates.includes(date))
    : [];

  return {
    ...(Object.prototype.hasOwnProperty.call(input, 'name') ? { name: input.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'description') ? { description: input.description } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'specifications') ? { specifications: String(input.specifications || '').trim() } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'priceUGX') ? { priceUGX: input.priceUGX } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'currency') ? { currency: input.currency } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'category') ? { category: input.category } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'subcategory') ? { subcategory: String(input.subcategory || '').trim() } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'itemCondition') ? { itemCondition: optionalEnum(input.itemCondition) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'images') ? { images: Array.isArray(input.images) ? input.images : [] } : {}),
    ...(
      Object.prototype.hasOwnProperty.call(input, 'featuredImage')
      || Object.prototype.hasOwnProperty.call(input, 'productVideoUrl')
      || Object.prototype.hasOwnProperty.call(input, 'productVideoThumbnailUrl')
        ? { featuredImage: resolvedFeaturedImage }
        : {}
    ),
    ...(Object.prototype.hasOwnProperty.call(input, 'productVideoUrl') ? { productVideoUrl: String(input.productVideoUrl || '').trim() } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'productVideoThumbnailUrl') ? { productVideoThumbnailUrl: String(input.productVideoThumbnailUrl || '').trim() } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'productVideoLikes') ? { productVideoLikes: Math.max(0, Number(input.productVideoLikes || 0)) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'productVideoComments') ? { productVideoComments: normalizeProductVideoComments(input.productVideoComments) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'itemType') ? { itemType: nextItemType } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'saleUnit') ? { saleUnit: input.saleUnit } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'size') ? { size: input.size } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'color') ? { color: input.color } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'productType') ? { productType: input.productType } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'brand') ? { brand: input.brand } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'yearOfManufacture') ? { yearOfManufacture: optionalString(input.yearOfManufacture) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'condition') ? { condition: optionalEnum(input.condition) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'transmission') ? { transmission: optionalEnum(input.transmission) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'bodyType') ? { bodyType: optionalEnum(input.bodyType) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'negotiable') ? { negotiable: Boolean(input.negotiable) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'hirePurchaseMonthlyUGX') ? {
      hirePurchaseMonthlyUGX: input.hirePurchaseMonthlyUGX === null || input.hirePurchaseMonthlyUGX === ''
        ? null
        : Math.max(0, Number(input.hirePurchaseMonthlyUGX || 0)),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'hirePurchaseDepositPercent') ? {
      hirePurchaseDepositPercent: input.hirePurchaseDepositPercent === null || input.hirePurchaseDepositPercent === ''
        ? null
        : Math.min(100, Math.max(0, Number(input.hirePurchaseDepositPercent || 0))),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'hirePurchaseTerms') ? {
      hirePurchaseTerms: String(input.hirePurchaseTerms || '').trim().slice(0, 5000) || null,
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'showCarMonthlyPayment') ? {
      showCarMonthlyPayment: Boolean(input.showCarMonthlyPayment),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'secondHandCondition') ? { secondHandCondition: optionalEnum(input.secondHandCondition) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'engineSize') ? { engineSize: optionalEnum(input.engineSize) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'fuelType') ? { fuelType: optionalEnum(input.fuelType) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'numberPlate') ? { numberPlate: optionalString(input.numberPlate) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'ageRange') ? { ageRange: input.ageRange } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'audience') ? { audience: nextItemType === 'service' ? 'adults' : (input.audience || 'children') } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'discountPercent') ? {
      discountPercent: input.discountPercent === null || input.discountPercent === ''
        ? null
        : Math.max(0, Number(input.discountPercent || 0)),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'stockQuantity') ? { stockQuantity: nextItemType === 'service' ? 1 : input.stockQuantity } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'deliveryAreas') ? { deliveryAreas: normalizeDeliveryAreas(input.deliveryAreas) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'paymentPhone') ? { paymentPhone: input.paymentPhone } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'paymentCode') ? { paymentCode: input.paymentCode } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'marketplaceSource') ? { marketplaceSource: normalizeMarketplaceSource(input.marketplaceSource) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'status') ? { status: input.status || 'active' } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'draftMeta') ? { draftMeta: input.draftMeta } : {}),
    ...(nextItemType === 'service' || Object.prototype.hasOwnProperty.call(input, 'serviceAvailabilityDates') ? { serviceAvailabilityDates: nextAvailabilityDates } : {}),
    ...(nextItemType === 'service' || Object.prototype.hasOwnProperty.call(input, 'serviceBookedDates') ? { serviceBookedDates: nextBookedDates } : {}),
  };
}

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
  /**
   * Get products owned by the current user.
   */
  async mine(ctx) {
    const user = await requireAuthUser(strapi, ctx);
    if (!user) {
      return ctx.unauthorized('You must be logged in to view your products');
    }

    const products = await strapi.documents('api::product.product').findMany({
      filters: {
        seller: { id: user.id },
      },
      populate: {
        seller: true,
      },
      sort: { createdAt: 'desc' },
      status: 'published',
    });

    const soldProducts = await Promise.all(products.map((product) => withSoldCount(strapi, product)));
    const promotedProducts = await attachActivePromotionState(strapi, soldProducts);
    return { data: await attachReviewSummary(strapi, promotedProducts) };
  },

  /**
   * Create a product and link it to the current user (the seller).
   */
  async create(ctx) {
    const user = await requireAuthUser(strapi, ctx);
    if (!user) {
      return ctx.unauthorized('You must be logged in to create a product');
    }

    const input = ctx.request.body?.data || {};
    let payload;
    let created;

    try {
      payload = finalizeProductWritePayload({
        ...input,
        audience: input.itemType === 'service' ? 'adults' : (input.audience || 'children'),
        stockQuantity: input.itemType === 'service' ? 1 : input.stockQuantity,
        serviceBookedDates: [],
      });

      created = await strapi.documents('api::product.product').create({
        data: {
          ...payload,
          seller: user.id,
        },
        populate: {
          seller: true,
        },
        status: 'published',
      });
    } catch (err) {
      if (err.name === 'ValidationError') return ctx.badRequest(err.message);
      strapi.log.error(`[product.create] ${err.message}`);
      const message = String(err.message || '');
      if (message.includes('must be one of') || message.toLowerCase().includes('invalid')) {
        return ctx.badRequest('One or more car fields have an invalid value. Please re-check condition, transmission, body type, engine size, and fuel.');
      }
      return ctx.badRequest(message || 'Could not create product');
    }

    if (Array.isArray(payload.images) && payload.images.length > 0) {
      scheduleProductImageProcessing(strapi, { documentId: created.documentId, id: created.id });
    }

    const withTerms = await applySellerHirePurchaseSettings(strapi, user, created, input);
    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, withTerms)) };
  },

  /**
   * Only return 'active' products by default for public users.
   */
  async find(ctx) {
    await clearExpiredProductPromotions(strapi);

    const filters = {
      ...(ctx.query.filters || {}),
    };

    const pagination = ctx.query.pagination || {};
    const page = parsePositiveInteger(
      pagination.page ?? ctx.query.page,
      1
    );
    const pageSize = parsePositiveInteger(
      pagination.pageSize ?? ctx.query.pageSize,
      25
    );

    if (!ctx.state.user) {
      filters.status = 'active';
    } else if (filters.status === 'draft' || filters.status?.$eq === 'draft') {
      filters.status = 'active';
    } else if (!filters.status) {
      filters.status = 'active';
    }

    const [products, total] = await Promise.all([
      strapi.documents('api::product.product').findMany({
        filters,
        populate: {
          seller: true,
        },
        sort: ctx.query.sort || [{ promotedUntil: 'desc' }, { createdAt: 'desc' }],
        start: (page - 1) * pageSize,
        limit: pageSize,
        status: 'published',
      }),
      strapi.documents('api::product.product').count({
        filters,
        status: 'published',
      }),
    ]);

    // Batched enrichment: one query for all seller profiles + one grouped
    // query for all sold counts, instead of two queries per product. Combined
    // with the already-batched promotion and review steps, a full page now runs
    // a small constant number of queries regardless of page size.
    const normalizedProducts = products.map((product) => withSellerPaymentFallback(product));
    const sellerEnrichedProducts = await enrichSellerIdentities(strapi, normalizedProducts);
    const soldProducts = await attachSoldCounts(strapi, sellerEnrichedProducts);
    const promotedProducts = await attachActivePromotionState(strapi, soldProducts);
    return {
      data: await attachReviewSummary(strapi, promotedProducts),
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize),
          total,
        },
      },
    };
  },

  async sellerCatalog(ctx) {
    await clearExpiredProductPromotions(strapi);

    const slug = slugifySellerName(ctx.params.slug);
    if (!slug) {
      return { data: [], meta: { total: 0 } };
    }

    // Pull every active product once (seller relation only) so we can resolve
    // each seller's display-name slug in memory instead of forcing the client
    // to page through the entire marketplace.
    const products = await strapi.documents('api::product.product').findMany({
      filters: { status: 'active' },
      populate: { seller: true },
      sort: [{ promotedUntil: 'desc' }, { createdAt: 'desc' }],
      limit: 5000,
      status: 'published',
    });

    // Resolve seller display names. The web client slugifies the entrepreneur
    // profile's fullName first, so batch-load those profiles in a single query.
    const sellerIds = [...new Set(products.map((p) => p.seller?.id).filter(Boolean))];
    const profiles = sellerIds.length
      ? await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
          filters: { user: { id: { $in: sellerIds } } },
          populate: { user: true },
          limit: sellerIds.length,
        }).catch(() => [])
      : [];

    const profileNameByUserId = new Map();
    for (const profile of profiles || []) {
      const userId = profile?.user?.id;
      if (userId && profile.fullName) {
        profileNameByUserId.set(userId, profile.fullName);
      }
    }

    const resolveDisplayName = (product) => (
      profileNameByUserId.get(product.seller?.id)
      || product.seller?.fullName
      || product.seller?.shopName
      || product.seller?.username
      || product.seller?.email
      || 'Movo Seller'
    );

    const matched = products.filter((product) => slugifySellerName(resolveDisplayName(product)) === slug);

    if (!matched.length) {
      return { data: [], meta: { total: 0 } };
    }

    // Enrich only the matched products (small set): sold counts + seller
    // identity, active promotions and review summaries.
    const soldProducts = await Promise.all(matched.map((product) => withSoldCount(strapi, product)));
    const promotedProducts = await attachActivePromotionState(strapi, soldProducts);
    const data = await attachReviewSummary(strapi, promotedProducts);

    return {
      data,
      meta: { total: data.length },
    };
  },

  async update(ctx) {
    const user = await requireAuthUser(strapi, ctx);
    if (!user) {
      return ctx.unauthorized('You must be logged in to update a product');
    }

    const existingProduct = await findProductByIdentifier(strapi, ctx.params.id);
    if (!existingProduct) {
      return ctx.notFound('Product not found');
    }

    if (!canManageProduct(ctx, existingProduct)) {
      return ctx.forbidden('You can only update your own products');
    }

    const input = ctx.request.body?.data || {};
    let payload;
    let updated;

    try {
      payload = finalizeProductWritePayload(input, existingProduct);
      updated = await strapi.documents('api::product.product').update({
        documentId: existingProduct.documentId,
        data: payload,
        populate: {
          seller: true,
        },
        status: 'published',
      });
    } catch (err) {
      if (err.name === 'ValidationError') return ctx.badRequest(err.message);
      strapi.log.error(`[product.update] ${err.message}`);
      const message = String(err.message || '');
      if (message.includes('must be one of') || message.toLowerCase().includes('invalid')) {
        return ctx.badRequest('One or more car fields have an invalid value. Please re-check condition, transmission, body type, engine size, and fuel.');
      }
      return ctx.badRequest(message || 'Could not update product');
    }

    if (Object.prototype.hasOwnProperty.call(input, 'images') && Array.isArray(payload.images) && payload.images.length > 0) {
      scheduleProductImageProcessing(strapi, { documentId: updated.documentId, id: updated.id });
    }

    const withTerms = await applySellerHirePurchaseSettings(strapi, user, updated, input);
    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, withTerms)) };
  },

  async delete(ctx) {
    const user = await requireAuthUser(strapi, ctx);
    if (!user) {
      return ctx.unauthorized('You must be logged in to delete a product');
    }

    const existingProduct = await findProductByIdentifier(strapi, ctx.params.id);
    if (!existingProduct) {
      return ctx.notFound('Product not found');
    }

    if (!canManageProduct(ctx, existingProduct)) {
      return ctx.forbidden('You can only delete your own products');
    }

    await strapi.documents('api::product.product').delete({
      documentId: existingProduct.documentId,
    });

    return { data: { documentId: existingProduct.documentId, deleted: true } };
  },

  async findOne(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);

    if (!product) {
      return ctx.notFound('Product not found');
    }

    if (product.status === 'draft') {
      if (!canManageProduct(ctx, product)) {
        return ctx.notFound('Product not found');
      }
    } else if (!ctx.state.user && product.status !== 'active') {
      return ctx.notFound('Product not found');
    }

    const soldProduct = await withSoldCount(strapi, product);
    const promotedProduct = await attachActivePromotionState(strapi, soldProduct);
    return { data: await attachReviewSummary(strapi, promotedProduct) };
  },

  async bookService(ctx) {
    const user = await requireAuthUser(strapi, ctx);
    if (!user) {
      return ctx.unauthorized('You must be logged in to book a service');
    }

    const product = await findProductByIdentifier(strapi, ctx.params.id);
    if (!product) {
      return ctx.notFound('Service not found');
    }

    if (product.itemType !== 'service') {
      return ctx.badRequest('Only services can be booked');
    }

    if (product.status !== 'active') {
      return ctx.badRequest('This service is not available for booking right now.');
    }

    const payload = ctx.request.body?.data || ctx.request.body || {};
    const serviceDate = normalizeServiceDate(payload.serviceDate);
    const contactName = String(payload.contactName || '').trim();
    const deliveryPhone = String(payload.deliveryPhone || '').trim();
    const deliveryAddress = String(payload.deliveryAddress || '').trim();

    if (!serviceDate) {
      return ctx.badRequest('Select a valid booking date.');
    }

    if (!contactName || !deliveryPhone || !deliveryAddress) {
      return ctx.badRequest('Name, phone number, and address are required to book a service.');
    }

    const bookedDates = normalizeServiceDateList(product.serviceBookedDates);

    if (bookedDates.includes(serviceDate)) {
      return ctx.badRequest('That date has already been booked.');
    }

    const amount = getDiscountedProductAmount(product);
    if (amount <= 0) {
      return ctx.badRequest('This service is not available for booking right now.');
    }

    const merchantReference = `SRV_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Create via the low-level db query so relations are guaranteed to attach
    // by numeric id. The documents() API has been observed to silently drop
    // manyToOne relations passed as a bare numeric id in Strapi 5.x.
    const createdRow = await strapi.db.query('api::purchase.purchase').create({
      data: {
        product: product.id,
        buyer: ctx.state.user.id,
        amount,
        paymentMethod: 'pay_on_delivery',
        transactionId: merchantReference,
        status: 'pending',
        deliveryStatus: 'pending_delivery',
        isPayOnDelivery: true,
        deliveryAddress,
        deliveryPhone,
        contactName,
        serviceDate,
        publishedAt: new Date(),
      },
      populate: {
        product: { populate: ['seller'] },
        buyer: true,
      },
    });

    strapi.log.info(`bookService: purchase ${createdRow?.id} created with product=${createdRow?.product?.id || 'NULL'} seller=${createdRow?.product?.seller?.id || 'NULL'} buyer=${createdRow?.buyer?.id || 'NULL'} date=${serviceDate}`);

    // Defensive: ensure the product/buyer relations actually persisted.
    if (!createdRow?.product?.id || !createdRow?.buyer?.id) {
      try {
        await strapi.db.query('api::purchase.purchase').update({
          where: { id: createdRow.id },
          data: {
            product: product.id,
            buyer: ctx.state.user.id,
          },
        });
        strapi.log.warn(`bookService: reattached product/buyer relations for purchase ${createdRow.id}`);
      } catch (err) {
        strapi.log.error(`bookService: failed to reattach relations for purchase ${createdRow.id}: ${err.message}`);
      }
    }

    const purchase = { documentId: createdRow.documentId, id: createdRow.id };

    const updatedProduct = await strapi.documents('api::product.product').update({
      documentId: product.documentId,
      data: {
        serviceBookedDates: [...bookedDates, serviceDate].sort(),
      },
      populate: {
        seller: true,
      },
      status: 'published',
    });

    return {
      data: {
        purchaseId: purchase.documentId,
        serviceDate,
        product: await attachReviewSummary(strapi, await withSoldCount(strapi, updatedProduct)),
      },
    };
  },

  async likeVideo(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);
    if (!product) return ctx.notFound('Product not found');
    if (!product.productVideoUrl) return ctx.badRequest('This product has no video');

    const updated = await strapi.documents('api::product.product').update({
      documentId: product.documentId,
      data: {
        productVideoLikes: Math.max(0, Number(product.productVideoLikes || 0)) + 1,
      },
      populate: { seller: true },
      status: 'published',
    });

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, updated)) };
  },

  async commentVideo(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in to comment on product videos');
    }

    const product = await findProductByIdentifier(strapi, ctx.params.id);
    if (!product) return ctx.notFound('Product not found');
    if (!product.productVideoUrl) return ctx.badRequest('This product has no video');

    const text = String(ctx.request.body?.data?.text || ctx.request.body?.text || '').trim().slice(0, 500);
    if (!text) return ctx.badRequest('Comment text is required');

    const currentComments = normalizeProductVideoComments(product.productVideoComments);
    const nextComment = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      authorId: String(ctx.state.user.id),
      authorName: String(ctx.state.user.fullName || ctx.state.user.username || 'Buyer').trim(),
      createdAt: new Date().toISOString(),
    };

    const updated = await strapi.documents('api::product.product').update({
      documentId: product.documentId,
      data: {
        productVideoComments: normalizeProductVideoComments([...currentComments, nextComment]),
      },
      populate: { seller: true },
      status: 'published',
    });

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, updated)) };
  },

  async marketplaceImpact(ctx) {
    const [activeProducts, totalRegisteredUsers] = await Promise.all([
      strapi.documents('api::product.product').findMany({
        filters: { status: 'active' },
        populate: { seller: true },
        fields: ['id', 'priceUGX'],
        status: 'published',
        limit: 10000,
      }),
      strapi.db.query('plugin::users-permissions.user').count({}),
    ]);

    const sellerIds = new Set(
      (activeProducts || [])
        .map((product) => product?.seller?.id)
        .filter(Boolean)
        .map(String)
    );

    const totalProductValueUGX = (activeProducts || []).reduce(
      (sum, product) => sum + Math.max(0, Number(product?.priceUGX || 0)),
      0
    );

    return {
      data: {
        totalBuyers: Number(totalRegisteredUsers || 0),
        totalRegisteredUsers: Number(totalRegisteredUsers || 0),
        totalSellers: sellerIds.size,
        totalProductValueUGX,
        totalPurchasedValueUGX: totalProductValueUGX,
      },
    };
  },

  /**
   * Admin-only: batch-optimize marketplace product images on the server.
   * Accepts full-access API tokens (for maintenance scripts).
   */
  async adminOptimizeImages(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const body = ctx.request.body || {};
    const query = ctx.query || {};
    const force = body.force === true || query.force === 'true';
    const documentId = String(body.documentId || query.documentId || '').trim() || null;
    const page = Math.max(1, Number.parseInt(body.page || query.page || '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(body.pageSize || query.pageSize || '25', 10) || 25));

    const where = documentId ? { documentId } : {};
    const offset = documentId ? 0 : (page - 1) * pageSize;

    const products = await strapi.db.query('api::product.product').findMany({
      where,
      select: ['id', 'documentId', 'name'],
      orderBy: { updatedAt: 'desc' },
      limit: documentId ? 1 : pageSize,
      offset,
    });

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const product of products) {
      try {
        const changed = await processProductImages(
          strapi,
          { documentId: product.documentId, id: product.id },
          { force },
        );
        if (changed) updated += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        errors.push({
          id: product.id,
          documentId: product.documentId,
          name: product.name,
          error: error.message,
        });
      }
    }

    const total = documentId
      ? products.length
      : await strapi.db.query('api::product.product').count({ where });

    return {
      data: {
        page,
        pageSize,
        total,
        processed: products.length,
        updated,
        skipped,
        failed,
        errors,
      },
    };
  },

  /**
   * Admin-only: update product image variants (used by remote optimization scripts).
   */
  async adminUpdateImages(ctx) {
    if (!(await assertAdmin(ctx, strapi))) return;

    const documentId = String(ctx.params.id || '').trim();
    if (!documentId) return ctx.badRequest('Missing product id');

    const { images, featuredImage } = ctx.request.body?.data || ctx.request.body || {};
    if (!Array.isArray(images) || images.length === 0) {
      return ctx.badRequest('images array is required');
    }

    const product = await strapi.db.query('api::product.product').findOne({
      where: { documentId },
      select: ['id', 'documentId'],
    });

    if (!product) return ctx.notFound('Product not found');

    const imagePayload = {
      images,
      ...(featuredImage ? { featuredImage } : {}),
    };

    await strapi.documents('api::product.product').update({
      documentId,
      data: imagePayload,
      status: 'published',
    });

    try {
      await strapi.documents('api::product.product').update({
        documentId,
        data: imagePayload,
        status: 'draft',
      });
    } catch (_) {
      // Draft row may not exist; published write is what the API serves.
    }

    return { data: { success: true, documentId } };
  },
}));
