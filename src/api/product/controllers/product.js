'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { scheduleProductImageProcessing } = require('../../../utils/marketplace-image-processing');

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
    itemType: product.itemType === 'service' ? 'service' : 'product',
    marketplaceSource: product.marketplaceSource || 'core',
    promotedUntil: product.promotedUntil || null,
    promotionKind: product.promotionKind || null,
    promotionBadgeLabel: product.promotionBadgeLabel || null,
    productVideoLikes: Math.max(0, Number(product.productVideoLikes || 0)),
    productVideoComments: normalizeProductVideoComments(product.productVideoComments),
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
    ...(Object.prototype.hasOwnProperty.call(input, 'yearOfManufacture') ? { yearOfManufacture: input.yearOfManufacture } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'condition') ? { condition: input.condition } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'transmission') ? { transmission: input.transmission } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'bodyType') ? { bodyType: input.bodyType } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'negotiable') ? { negotiable: Boolean(input.negotiable) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'secondHandCondition') ? { secondHandCondition: input.secondHandCondition } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'engineSize') ? { engineSize: input.engineSize } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'fuelType') ? { fuelType: input.fuelType } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'ageRange') ? { ageRange: input.ageRange } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'audience') ? { audience: nextItemType === 'service' ? 'adults' : (input.audience || 'children') } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'discountPercent') ? { discountPercent: input.discountPercent } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'stockQuantity') ? { stockQuantity: nextItemType === 'service' ? 1 : input.stockQuantity } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'deliveryAreas') ? { deliveryAreas: normalizeDeliveryAreas(input.deliveryAreas) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'paymentPhone') ? { paymentPhone: input.paymentPhone } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'paymentCode') ? { paymentCode: input.paymentCode } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'marketplaceSource') ? { marketplaceSource: normalizeMarketplaceSource(input.marketplaceSource) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'status') ? { status: input.status || 'active' } : {}),
    ...(nextItemType === 'service' || Object.prototype.hasOwnProperty.call(input, 'serviceAvailabilityDates') ? { serviceAvailabilityDates: nextAvailabilityDates } : {}),
    ...(nextItemType === 'service' || Object.prototype.hasOwnProperty.call(input, 'serviceBookedDates') ? { serviceBookedDates: nextBookedDates } : {}),
  };
}

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
  /**
   * Get products owned by the current user.
   */
  async mine(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in to view your products');
    }

    const products = await strapi.documents('api::product.product').findMany({
      filters: {
        seller: { id: ctx.state.user.id },
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
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in to create a product');
    }

    const input = ctx.request.body?.data || {};
    const payload = buildProductPayload({
      ...input,
      audience: input.itemType === 'service' ? 'adults' : (input.audience || 'children'),
      stockQuantity: input.itemType === 'service' ? 1 : input.stockQuantity,
      serviceBookedDates: [],
    });

    const created = await strapi.documents('api::product.product').create({
      data: {
        ...payload,
        seller: ctx.state.user.id,
      },
      populate: {
        seller: true,
      },
      status: 'published',
    });

    scheduleProductImageProcessing(strapi, { documentId: created.documentId, id: created.id });

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, created)) };
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
    if (!ctx.state.user) {
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
    const updated = await strapi.documents('api::product.product').update({
      documentId: existingProduct.documentId,
      data: buildProductPayload(input, existingProduct),
      populate: {
        seller: true,
      },
      status: 'published',
    });

    if (Object.prototype.hasOwnProperty.call(input, 'images')) {
      scheduleProductImageProcessing(strapi, { documentId: updated.documentId, id: updated.id });
    }

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, updated)) };
  },

  async findOne(ctx) {
    const product = await findProductByIdentifier(strapi, ctx.params.id);

    if (!product) {
      return ctx.notFound('Product not found');
    }

    if (!ctx.state.user && product.status !== 'active') {
      return ctx.notFound('Product not found');
    }

    const soldProduct = await withSoldCount(strapi, product);
    const promotedProduct = await attachActivePromotionState(strapi, soldProduct);
    return { data: await attachReviewSummary(strapi, promotedProduct) };
  },

  async bookService(ctx) {
    if (!ctx.state.user) {
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
}));
