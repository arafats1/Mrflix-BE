'use strict';

function getPromotionEndDate(durationDays) {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + Math.max(1, Number(durationDays || 1)));
  return { now, endDate };
}

async function markSellerProductsPromoted(strapi, sellerId, endDate, promotionKind) {
  const products = await strapi.documents('api::product.product').findMany({
    filters: { seller: { id: sellerId } },
    status: 'published',
    limit: 1000,
  });

  for (const product of products || []) {
    await strapi.documents('api::product.product').update({
      documentId: product.documentId,
      status: 'published',
      data: {
        promotedUntil: endDate.toISOString(),
        promotionKind,
        promotionBadgeLabel: 'Promoted',
      },
    });
  }
}

async function markSingleProductPromoted(strapi, product, endDate, promotionKind) {
  if (!product?.documentId) return;
  await strapi.documents('api::product.product').update({
    documentId: product.documentId,
    status: 'published',
    data: {
      promotedUntil: endDate.toISOString(),
      promotionKind,
      promotionBadgeLabel: 'Promoted',
    },
  });
}

async function activatePromotion(strapi, promotion) {
  if (!promotion) return null;

  const fullPromotion = promotion.product && promotion.seller ? promotion : await strapi.entityService.findOne(
    'api::marketplace-promotion.marketplace-promotion',
    promotion.id,
    { populate: { product: true, seller: true } }
  );

  const { now, endDate } = getPromotionEndDate(fullPromotion.durationDays);
  const promotionType = fullPromotion.promotionType === 'seller' ? 'seller' : 'product';
  const sellerId = fullPromotion.seller?.id;

  if (promotionType === 'seller') {
    await markSellerProductsPromoted(strapi, sellerId, endDate, 'seller');
  } else {
    await markSingleProductPromoted(strapi, fullPromotion.product, endDate, 'product');
  }

  return strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', fullPromotion.id, {
    data: {
      status: 'active',
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
    },
  });
}

async function activatePromotionByFilter(strapi, filters, paymentMethod) {
  const promotions = await strapi.entityService.findMany('api::marketplace-promotion.marketplace-promotion', {
    filters,
    populate: { product: true, seller: true },
    limit: 10,
  });

  for (const promotion of promotions || []) {
    if (promotion.status !== 'active') {
      await strapi.entityService.update('api::marketplace-promotion.marketplace-promotion', promotion.id, {
        data: paymentMethod ? { paymentMethod } : {},
      });
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
