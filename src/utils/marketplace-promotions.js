'use strict';

/**
 * Marketplace promotion activation.
 *
 * Strategy:
 *   We update product rows directly via `strapi.db.query()` so that BOTH the
 *   draft AND the published row are mutated in one shot. This bypasses any
 *   Document Service ambiguity around `status: 'draft' | 'published'` when
 *   draftAndPublish is enabled, which historically left the published copy
 *   untouched even after a successful `documents().update()` call.
 *
 *   After the raw update we trigger `documents().publish()` defensively so any
 *   listeners that watch document events get notified — but the source of
 *   truth (the database row that `/products` and `/products/mine` read) is
 *   already updated.
 */

function getPromotionEndDate(durationDays) {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + Math.max(1, Number(durationDays || 1)));
  return { now, endDate };
}

async function rawUpdateProductPromotion(strapi, documentId, fields) {
  if (!documentId) return 0;

  let updatedCount = 0;
  try {
    const rows = await strapi.db.query('api::product.product').findMany({
      where: { documentId },
      select: ['id', 'publishedAt'],
    });

    for (const row of rows || []) {
      await strapi.db.query('api::product.product').update({
        where: { id: row.id },
        data: fields,
      });
      updatedCount += 1;
    }
  } catch (err) {
    strapi.log.error(`[promotion] raw DB update failed for product ${documentId}: ${err.message}`);
  }

  try {
    await strapi.documents('api::product.product').publish({ documentId });
  } catch (err) {
    strapi.log.debug(`[promotion] publish noop for product ${documentId}: ${err.message}`);
  }

  strapi.log.info(`[promotion] product ${documentId} marked promoted (${updatedCount} row${updatedCount === 1 ? '' : 's'} updated)`);
  return updatedCount;
}

async function markSellerProductsPromoted(strapi, sellerId, endDate, promotionKind) {
  const products = await strapi.db.query('api::product.product').findMany({
    where: { seller: sellerId, publishedAt: { $notNull: true } },
    select: ['documentId'],
    limit: 1000,
  });

  const seen = new Set();
  for (const product of products || []) {
    if (!product?.documentId || seen.has(product.documentId)) continue;
    seen.add(product.documentId);
    await rawUpdateProductPromotion(strapi, product.documentId, {
      promotedUntil: endDate,
      promotionKind,
      promotionBadgeLabel: 'Promoted',
    });
  }

  strapi.log.info(`[promotion] seller ${sellerId} promoted: ${seen.size} product(s)`);
}

async function markSingleProductPromoted(strapi, productRef, endDate, promotionKind) {
  if (!productRef) return;

  let documentId = productRef.documentId || null;
  if (!documentId && productRef.id) {
    const row = await strapi.db.query('api::product.product').findOne({
      where: { id: productRef.id },
      select: ['documentId'],
    });
    documentId = row?.documentId || null;
  }
  if (!documentId) {
    strapi.log.warn('[promotion] markSingleProductPromoted: no documentId resolved');
    return;
  }

  await rawUpdateProductPromotion(strapi, documentId, {
    promotedUntil: endDate,
    promotionKind,
    promotionBadgeLabel: 'Promoted',
  });
}

async function activatePromotion(strapi, promotion) {
  if (!promotion) return null;

  const fullPromotion = await strapi.entityService.findOne(
    'api::marketplace-promotion.marketplace-promotion',
    promotion.id,
    { populate: { product: true, seller: true } }
  );

  if (!fullPromotion) {
    strapi.log.warn(`[promotion] activatePromotion: promotion ${promotion.id} not found`);
    return null;
  }

  const { now, endDate } = getPromotionEndDate(fullPromotion.durationDays);
  const promotionType = fullPromotion.promotionType === 'seller' ? 'seller' : 'product';
  const sellerId = fullPromotion.seller?.id;

  strapi.log.info(`[promotion] activating promotion ${fullPromotion.id} type=${promotionType} seller=${sellerId} endDate=${endDate.toISOString()}`);

  if (promotionType === 'seller') {
    if (!sellerId) {
      strapi.log.warn(`[promotion] no seller on promotion ${fullPromotion.id}; cannot mark products`);
    } else {
      await markSellerProductsPromoted(strapi, sellerId, endDate, 'seller');
    }
  } else {
    await markSingleProductPromoted(strapi, fullPromotion.product, endDate, 'product');
  }

  const updated = await strapi.entityService.update(
    'api::marketplace-promotion.marketplace-promotion',
    fullPromotion.id,
    {
      data: {
        status: 'active',
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
      },
      populate: { product: true, seller: true },
    }
  );

  strapi.log.info(`[promotion] promotion ${fullPromotion.id} now active until ${endDate.toISOString()}`);
  return updated;
}

async function activatePromotionByFilter(strapi, filters, paymentMethod) {
  const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
    filters,
    populate: { product: true, seller: true },
    limit: 10,
  });

  for (const promotion of promotions || []) {
    if (promotion.status !== 'active') {
      if (paymentMethod) {
        await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', promotion.id, {
          data: { paymentMethod },
        });
      }
      await activatePromotion(strapi, promotion);
    }
  }

  return promotions || [];
}

async function failPromotionByFilter(strapi, filters) {
  const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
    filters,
    limit: 10,
  });

  for (const promotion of promotions || []) {
    if (promotion.status === 'pending') {
      await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', promotion.id, {
        data: { status: 'cancelled' },
      });
    }
  }
}

module.exports = {
  activatePromotion,
  activatePromotionByFilter,
  failPromotionByFilter,
};
