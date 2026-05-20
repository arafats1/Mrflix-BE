'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

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
  };
}

function normalizeMarketplaceSource(value) {
  return value === 'entrepreneur' ? 'entrepreneur' : 'core';
}

function normalizeItemType(value) {
  return value === 'service' ? 'service' : 'product';
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
  const sellerProfilePhotoUrl = entrepreneurProfile?.profilePhotoUrl || null;

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
    ...(Object.prototype.hasOwnProperty.call(input, 'priceUGX') ? { priceUGX: input.priceUGX } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'category') ? { category: input.category } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'images') ? { images: Array.isArray(input.images) ? input.images : [] } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'featuredImage') ? { featuredImage: input.featuredImage } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'itemType') ? { itemType: nextItemType } : {}),
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
    return { data: await attachReviewSummary(strapi, soldProducts) };
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

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, created)) };
  },

  /**
   * Only return 'active' products by default for public users.
   */
  async find(ctx) {
    const filters = {
      ...(ctx.query.filters || {}),
    };

    if (!ctx.state.user) {
      filters.status = 'active';
    }

    const products = await strapi.documents('api::product.product').findMany({
      filters,
      populate: {
        seller: true,
      },
      sort: ctx.query.sort || { createdAt: 'desc' },
      status: 'published',
    });

    const soldProducts = await Promise.all(products.map((product) => withSoldCount(strapi, product)));
    return { data: await attachReviewSummary(strapi, soldProducts) };
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

    return { data: await attachReviewSummary(strapi, await withSoldCount(strapi, product)) };
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
}));
