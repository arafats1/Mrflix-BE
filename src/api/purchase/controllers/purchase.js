'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { submitPayment, checkPaymentStatus, getActiveGateway, gatewayNeedsPhone, buildGatewayTrackingUpdate, resolveRecordGateway } = require('../../../utils/payment-gateway');
const { recordProviderMaterialSale } = require('../../../utils/provider-material-sales');
const { notifyBuyerOrderStatus, notifyProductOrderPlaced } = require('../../../utils/marketplace-notifications');

function getDiscountedProductAmount(product) {
  const basePrice = Number(product?.priceUGX || 0);
  const discountPercent = Math.min(100, Math.max(0, Number(product?.discountPercent || 0)));

  if (discountPercent <= 0) {
    return basePrice;
  }

  const savings = Math.round(basePrice * (discountPercent / 100));
  return Math.max(basePrice - savings, 0);
}

async function findPurchaseTarget(strapi, { movieId, providerMaterialId, productId, bookId }) {
  if (bookId) {
    const book = await strapi.documents('api::book.book').findOne({
      documentId: bookId,
    });

    if (!book) return null;

    return {
      kind: 'book',
      id: book.id,
      documentId: book.documentId,
      title: book.title,
      amount: null,
      book,
    };
  }

  if (productId) {
    const product = await strapi.documents('api::product.product').findOne({
      documentId: productId,
      populate: { seller: true },
    });

    if (!product) return null;

    return {
      kind: 'product',
      id: product.id,
      documentId: product.documentId,
      title: product.name,
      amount: getDiscountedProductAmount(product),
      product,
    };
  }

  if (providerMaterialId) {
    const material = await strapi.documents('api::provider-material.provider-material').findOne({
      documentId: providerMaterialId,
      populate: {
        provider: true,
        subject: true,
        course: true,
      },
    });

    if (!material) return null;

    return {
      kind: 'provider_material',
      id: material.id,
      documentId: material.documentId,
      title: material.title,
      amount: Number(material.priceUGX || 0),
      material,
    };
  }

  if (movieId) {
    const movie = await strapi.documents('api::movie.movie').findOne({
      documentId: movieId,
    });

    if (!movie) return null;

    return {
      kind: 'movie',
      id: movie.id,
      documentId: movie.documentId,
      title: movie.title,
      amount: null,
      movie,
    };
  }

  return null;
}

async function findOwnedChildProfile(strapi, userId, childProfileId) {
  if (!childProfileId) return null;

  const numericId = Number(childProfileId);
  if (!Number.isFinite(numericId)) return null;

  return strapi.db.query('api::child-profile.child-profile').findOne({
    where: {
      id: numericId,
      parent: { id: userId },
    },
    select: ['id', 'name'],
  });
}

function buildPurchaseInfo(purchase) {
  if (purchase.product) {
    const product = purchase.product;
    return {
      kind: 'product',
      id: product.documentId || product.id,
      title: product.name,
      price: purchase.amount,
      isPayOnDelivery: purchase.isPayOnDelivery,
    };
  }

  if (purchase.providerMaterial) {
    const material = purchase.providerMaterial;
    return {
      kind: 'provider_material',
      id: material.documentId || material.id,
      title: material.title,
      type: material.mediaType,
      childProfileId: purchase.childProfile?.id || null,
      childProfileName: purchase.childProfile?.name || null,
    };
  }

  if (purchase.movie) {
    const movie = purchase.movie;
    return {
      kind: 'movie',
      id: movie.documentId || movie.id,
      title: movie.title,
      type: movie.type,
    };
  }

  if (purchase.book) {
    const book = purchase.book;
    return {
      kind: 'book',
      id: book.documentId || book.id,
      title: book.title,
      purchaseType: purchase.purchaseType,
    };
  }

  return null;
}

function formatBuyerContact(user) {
  if (!user) return '';

  const phone = typeof user.phone === 'string' ? user.phone.trim() : '';
  if (phone) return phone;

  const email = typeof user.email === 'string' ? user.email.trim() : '';
  return email.endsWith('@phone.movokids.local') ? '' : email;
}

function normalizeDeliveryStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'delivered') return 'delivered';
  if (value === 'not_delivered' || value === 'not delivered') return 'not_delivered';
  return 'pending_delivery';
}

async function resolveRequestUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
  }

  const authHeader = ctx.request.header?.authorization || ctx.request.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const { id } = await strapi.plugins['users-permissions'].services.jwt.verify(token);
      if (id) {
        return strapi.query('plugin::users-permissions.user').findOne({
          where: { id },
          populate: ['role'],
        });
      }
    } catch (_) {
      return null;
    }
  }

  return null;
}

async function markPurchasesCompleted(strapi, purchases, paymentData = {}) {
  for (const purchase of purchases) {
    if (purchase.status === 'completed') continue;

    if (purchase.providerMaterial) {
      await recordProviderMaterialSale(strapi, purchase);
    }

    const updateData = {
      status: 'completed',
      ...paymentData,
    };

    // Movies (not series) expire after 24 hours
    if (purchase.movie && purchase.movie.type === 'movie' && !purchase.expiresAt) {
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 24);
      updateData.expiresAt = expirationDate;
    }

    const updated = await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: updateData,
      populate: {
        buyer: true,
        product: { populate: { seller: true } },
      },
    });

    if (updated.product) {
      await notifyProductOrderPlaced(strapi, updated, { statusLabel: 'Payment completed' });
    }
  }
}


function getMovieAmount(settings, movie, seasonNumber) {
  // Movies and series use the same site-setting movie price.
  return settings?.moviePrice ?? 2000;
}

function getBookAmount(settings, purchaseType) {
  if (purchaseType === 'download') {
    return settings?.bookDownloadPrice ?? 5000;
  }
  if (purchaseType === 'book_subscription') {
    return settings?.bookSubscriptionPrice ?? 10000;
  }
  return settings?.bookReadPrice ?? 500;
}

function resolveTimedBookExpiry(purchase, settings, now = new Date()) {
  if (!purchase) return null;
  if (purchase.expiresAt) {
    const explicitExpiry = new Date(purchase.expiresAt);
    return Number.isNaN(explicitExpiry.getTime()) ? null : explicitExpiry;
  }

  const createdAt = new Date(purchase.createdAt || now);
  if (Number.isNaN(createdAt.getTime())) return null;

  const purchaseType = String(purchase.purchaseType || 'read');
  if (purchaseType === 'download') {
    return null;
  }
  if (purchaseType === 'book_subscription') {
    const days = Number(settings?.bookSubscriptionDays) > 0 ? Number(settings.bookSubscriptionDays) : 30;
    return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
  }

  const hours = Number(settings?.bookRentalHours) > 0 ? Number(settings.bookRentalHours) : 24;
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
}

function createBookExpiryIso(settings, purchaseType, now = new Date()) {
  if (purchaseType === 'download') return null;

  const base = new Date(now);
  if (purchaseType === 'book_subscription') {
    const days = Number(settings?.bookSubscriptionDays) > 0 ? Number(settings.bookSubscriptionDays) : 30;
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const hours = Number(settings?.bookRentalHours) > 0 ? Number(settings.bookRentalHours) : 24;
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function resolvePaymentCallbackUrl(rawValue, fallbackUrl) {
  const fallback = String(fallbackUrl || '').trim();
  const input = String(rawValue || '').trim();
  if (!input) return fallback;

  if (/^movomarket:\/\//i.test(input)) return input;
  if (/^https?:\/\//i.test(input)) return input;

  return fallback;
}

module.exports = createCoreController('api::purchase.purchase', ({ strapi }) => ({
  // Users see their own purchases, admins see all with buyer info
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const userWithRole = await strapi.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: ['role'],
    });
    const isAdmin = userWithRole?.role?.type === 'admin' || userWithRole?.role?.name === 'Admin';

    const filters = {};
    if (!isAdmin) {
      filters.buyer = { id: ctx.state.user.id };
    }

    const populate = isAdmin
      ? {
        movie: { populate: '*' },
        book: { populate: '*' },
        providerMaterial: { populate: '*' },
        product: { populate: '*' },
        buyer: { populate: '*' },
        childProfile: true,
      }
      : {
        movie: { populate: '*' },
        book: { populate: '*' },
        providerMaterial: { populate: '*' },
        product: { populate: '*' },
        childProfile: true,
      };

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters,
      populate,
      sort: { createdAt: 'desc' },
    });

    return { data: purchases, meta: { pagination: { total: purchases.length } } };
  },

  async sellerOrders(ctx) {
    const requestUser = await resolveRequestUser(strapi, ctx);
    if (!requestUser) {
      return ctx.unauthorized('You must be logged in');
    }

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      populate: {
        product: {
          populate: {
            seller: true,
          },
        },
        buyer: true,
      },
      sort: { createdAt: 'desc' },
    });

    const sellerPurchases = (purchases || []).filter((purchase) => {
      return purchase?.product?.seller?.id === requestUser.id;
    });

    // Diagnostic: log any orphaned service purchases (have serviceDate but
    // no product relation) so a missing customer-details card has a clear
    // root cause when troubleshooting.
    const orphanServicePurchases = (purchases || []).filter((purchase) => {
      return purchase?.serviceDate && !purchase?.product?.id;
    });
    if (orphanServicePurchases.length) {
      strapi.log.warn(`sellerOrders: ${orphanServicePurchases.length} service purchase(s) have no product relation; ids=${orphanServicePurchases.map((p) => p.id).join(',')}`);

      // Attempt to repair orphan service purchases by matching their
      // serviceDate against any of this seller's service products with that
      // date in serviceBookedDates. This recovers bookings that were saved
      // before the bookService relation fix.
      const sellerServices = await strapi.documents('api::product.product').findMany({
        filters: {
          itemType: 'service',
          seller: { id: requestUser.id },
        },
        populate: { seller: true },
        status: 'published',
      });

      for (const orphan of orphanServicePurchases) {
        const match = sellerServices.find((service) => (
          Array.isArray(service.serviceBookedDates) && service.serviceBookedDates.includes(orphan.serviceDate)
        ));
        if (!match) continue;
        try {
          await strapi.db.query('api::purchase.purchase').update({
            where: { id: orphan.id },
            data: { product: match.id },
          });
          strapi.log.info(`sellerOrders: repaired orphan purchase ${orphan.id} -> product ${match.id} (${match.name})`);
          // Refresh in-memory representation so it surfaces this request.
          orphan.product = { ...match, seller: { id: requestUser.id } };
          sellerPurchases.push(orphan);
        } catch (err) {
          strapi.log.error(`sellerOrders: repair failed for purchase ${orphan.id}: ${err.message}`);
        }
      }
    }

    return {
      data: sellerPurchases.map((purchase) => ({
        ...purchase,
        deliveryStatus: normalizeDeliveryStatus(purchase.deliveryStatus),
        buyer: purchase.buyer
          ? {
              ...purchase.buyer,
              displayContact: formatBuyerContact(purchase.buyer),
            }
          : null,
      })),
      meta: { pagination: { total: sellerPurchases.length } },
    };
  },

  async updateSellerDeliveryStatus(ctx) {
    const requestUser = await resolveRequestUser(strapi, ctx);
    if (!requestUser) {
      return ctx.unauthorized('You must be logged in');
    }

    const purchaseId = ctx.params?.id;
    const nextStatus = normalizeDeliveryStatus((ctx.request.body.data || ctx.request.body || {}).deliveryStatus);

    if (!purchaseId) {
      return ctx.badRequest('Missing purchase id');
    }

    const purchase = await strapi.documents('api::purchase.purchase').findOne({
      documentId: purchaseId,
      populate: {
        product: {
          populate: {
            seller: true,
          },
        },
        buyer: true,
      },
    });

    if (!purchase) {
      return ctx.notFound('Order not found');
    }

    if (!purchase.product || purchase.product.seller?.id !== requestUser.id) {
      return ctx.forbidden('You can only update your own product orders');
    }

    const previousStatus = normalizeDeliveryStatus(purchase.deliveryStatus);

    const updateData = {
      deliveryStatus: nextStatus,
    };

    // Cash-on-delivery and direct supplier payments stay pending until the seller
    // confirms delivery. Completing the purchase here keeps payment in sync with delivery.
    if (nextStatus === 'delivered' && purchase.status === 'pending') {
      updateData.status = 'completed';
    }

    const updated = await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: updateData,
      populate: {
        product: true,
        buyer: true,
      },
    });

    if (previousStatus !== nextStatus) {
      await notifyBuyerOrderStatus(strapi, updated, requestUser.id, nextStatus);
    }

    return {
      data: {
        ...updated,
        deliveryStatus: normalizeDeliveryStatus(updated.deliveryStatus),
      },
    };
  },

  /**
   * Create a purchase — initiates Pesapal payment.
   * Returns a redirect_url the frontend should open.
   */
  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const {
      movieId,
      providerMaterialId,
      productId,
      bookId,
      purchaseType,
      paymentMethod,
      paymentPhone,
      customerTransactionId,
      seasonNumber,
      isPayOnDelivery,
      deliveryAddress,
      deliveryPhone,
      contactName,
      quantity: requestedQuantity,
      callbackUrl: rawCallbackUrl,
    } = ctx.request.body.data || ctx.request.body;
    const childProfileId = (ctx.request.body.data || ctx.request.body || {}).childProfileId;

    if (!movieId && !providerMaterialId && !productId && !bookId) {
      return ctx.badRequest('Missing required field: movieId, providerMaterialId, productId or bookId');
    }

    const target = await findPurchaseTarget(strapi, { movieId, providerMaterialId, productId, bookId });
    if (!target) {
      return ctx.notFound(productId ? 'Product not found' : providerMaterialId ? 'Provider material not found' : bookId ? 'Book not found' : 'Movie not found');
    }

    if (target.kind === 'book' && !['read', 'download', 'book_subscription'].includes(purchaseType)) {
      return ctx.badRequest('Missing or invalid purchaseType for book (read, download or book_subscription)');
    }

    const childProfile = target.kind === 'provider_material' && childProfileId
      ? await findOwnedChildProfile(strapi, ctx.state.user.id, childProfileId)
      : null;

    if (target.kind === 'provider_material' && childProfileId && !childProfile) {
      return ctx.badRequest('Select a valid child profile for this material');
    }

    if (target.kind !== 'product') {
      const filters = {
        buyer: { id: ctx.state.user.id },
        status: 'completed',
      };

      if (target.kind === 'provider_material') {
        filters.providerMaterial = { id: target.id };
        if (childProfile) {
          filters.childProfile = { id: childProfile.id };
        }
      } else if (target.kind === 'book') {
        filters.book = { id: target.id };
        // If they already have download access, they have everything.
        // If they only have timed access, they can still buy download.
        if (purchaseType === 'read') {
          filters.purchaseType = { $in: ['read', 'download'] };
        } else if (purchaseType === 'book_subscription') {
          filters.purchaseType = 'book_subscription';
        } else {
          filters.purchaseType = 'download';
        }
      } else {
        filters.movie = { id: target.id };
      }

      if (target.kind === 'movie' && target.movie.type === 'series' && seasonNumber) {
        filters.seasonNumber = parseInt(seasonNumber);
      }

      const existing = await strapi.documents('api::purchase.purchase').findMany({
        filters,
      });

      const now = new Date();
      const validPurchases = existing.filter((purchase) => {
        if (target.kind !== 'book') {
          return !purchase.expiresAt || new Date(purchase.expiresAt) > now;
        }

        if (String(purchase.purchaseType || '') === 'download') {
          return true;
        }

        const expiry = resolveTimedBookExpiry(purchase, settings, now);
        return !!expiry && expiry > now;
      });

      if (validPurchases.length > 0) {
        return ctx.badRequest('You already own this ' + (seasonNumber ? `season ${seasonNumber}` : target.kind === 'provider_material' ? 'material' : target.kind === 'book' ? 'book' : 'movie'));
      }
    }

    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const quantity = target.kind === 'product'
      ? Math.max(1, parseInt(requestedQuantity, 10) || 1)
      : 1;

    let amount = target.kind === 'provider_material' || target.kind === 'product'
      ? target.amount
      : target.kind === 'book'
        ? getBookAmount(settings, purchaseType)
        : getMovieAmount(settings, target.movie, seasonNumber);

    if (target.kind === 'product') {
      amount = getDiscountedProductAmount(target.product) * quantity;
      const stockQuantity = Number(target.product?.stockQuantity ?? 0);
      if (target.product?.itemType !== 'service' && stockQuantity > 0 && quantity > stockQuantity) {
        return ctx.badRequest(`Only ${stockQuantity} available in stock.`);
      }
    }

    if ((target.kind === 'provider_material' || target.kind === 'product') && amount <= 0) {
      return ctx.badRequest('This item is not available for purchase.');
    }

    const merchantReference = `PUR_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const description = target.kind === 'provider_material' || target.kind === 'product' || target.kind === 'book'
      ? target.title
      : seasonNumber
        ? `${target.movie.title} - Season ${seasonNumber}`
        : target.movie.title;
    const manualSupplierPayment = target.kind === 'product' && paymentMethod === 'manual_supplier_payment';
    const payOnDeliveryOrder = target.kind === 'product' && (paymentMethod === 'pay_on_delivery' || isPayOnDelivery);
    const requiresGateway = !manualSupplierPayment && !payOnDeliveryOrder;
    let activeGateway = null;

    if (manualSupplierPayment && !String(customerTransactionId || '').trim()) {
      return ctx.badRequest('Transaction ID is required after paying the supplier.');
    }

    if (requiresGateway) {
      activeGateway = await getActiveGateway(strapi);
      const ipnId = settings?.pesapalIpnId;

      if (activeGateway === 'pesapal' && !ipnId) {
        strapi.log.error('Pesapal IPN ID not configured.');
        return ctx.badRequest('Payment system not configured. Please contact support.');
      }

      if (gatewayNeedsPhone(activeGateway) && !paymentPhone) {
        return ctx.badRequest('Phone number is required for mobile money payment.');
      }
    }

    const frontendUrl = process.env.FRONTEND_URL;
    const callbackUrl = resolvePaymentCallbackUrl(rawCallbackUrl, `${frontendUrl}/payment/callback`);

    const purchaseData = {
      movie: target.kind === 'movie' ? target.id : null,
      providerMaterial: target.kind === 'provider_material' ? target.id : null,
      product: target.kind === 'product' ? target.id : null,
      buyer: ctx.state.user.id,
      childProfile: childProfile?.id || null,
      amount,
      quantity: target.kind === 'product' ? quantity : 1,
      paymentMethod: manualSupplierPayment ? 'manual_supplier_payment' : payOnDeliveryOrder ? 'pay_on_delivery' : (paymentMethod || activeGateway),
      paymentPhone: paymentPhone || '',
      transactionId: merchantReference,
      customerTransactionId: manualSupplierPayment ? String(customerTransactionId || '').trim() : '',
      status: 'pending',
      deliveryStatus: target.kind === 'product' ? 'pending_delivery' : null,
      seasonNumber: (target.kind === 'movie' && target.movie.type === 'series' && seasonNumber) ? seasonNumber : null,
      book: target.kind === 'book' ? target.id : null,
      purchaseType: target.kind === 'book' ? purchaseType : null,
      expiresAt: target.kind === 'book' ? createBookExpiryIso(settings, purchaseType) : null,
      isPayOnDelivery: !!payOnDeliveryOrder,
      deliveryAddress: deliveryAddress || '',
      deliveryPhone: deliveryPhone || '',
      contactName: contactName || '',
    };

    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: purchaseData,
      populate: {
        buyer: true,
        product: { populate: { seller: true } },
      },
    });

    if (manualSupplierPayment || payOnDeliveryOrder) {
      if (purchase.product) {
        await notifyProductOrderPlaced(strapi, purchase, {
          statusLabel: manualSupplierPayment ? 'Supplier payment submitted' : 'Pay on delivery',
        });
      }

      return {
        data: {
          purchaseId: purchase.documentId,
          transactionId: merchantReference,
          status: 'pending',
          isPayOnDelivery: !!payOnDeliveryOrder,
          isManualSupplierPayment: !!manualSupplierPayment,
        },
      };
    }

    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const ipnId = settings?.pesapalIpnId;
      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount,
        description: `Mr.Flix - ${description}`,
        callbackUrl,
        ipnId,
        paymentPhone: paymentPhone || '',
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      const updateData = buildGatewayTrackingUpdate(paymentResult);

      await strapi.documents('api::purchase.purchase').update({
        documentId: purchase.documentId,
        data: updateData,
      });

      return {
        data: {
          purchaseId: purchase.documentId,
          transactionId: merchantReference,
          gateway: paymentResult.gateway,
          // Pesapal fields
          redirect_url: paymentResult.redirect_url || null,
          order_tracking_id: paymentResult.order_tracking_id || null,
          // DGateway fields
          reference: paymentResult.reference || null,
          paymentStatus: paymentResult.status || null,
        },
      };
    } catch (err) {
      strapi.log.error('Payment order submission failed:', err);
      await strapi.documents('api::purchase.purchase').update({
        documentId: purchase.documentId,
        data: { status: 'failed' },
      });
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  /**
   * Bulk purchase — for cart checkout.
   * Creates pending purchases for all movies, submits one combined Pesapal order.
   */
  async createBulk(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieIds, items, paymentMethod, paymentPhone } = ctx.request.body.data || ctx.request.body;
    const normalizedItems = Array.isArray(items)
      ? items
      : Array.isArray(movieIds)
        ? movieIds.map((movieId) => ({ kind: 'movie', id: movieId }))
        : [];

    if (normalizedItems.length === 0) {
      return ctx.badRequest('Missing required field: items (array)');
    }

    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const activeGateway = await getActiveGateway(strapi);
    const ipnId = settings?.pesapalIpnId;

    if (activeGateway === 'pesapal' && !ipnId) {
      return ctx.badRequest('Payment system not configured. Please contact support.');
    }
    if (gatewayNeedsPhone(activeGateway) && !paymentPhone) {
      return ctx.badRequest('Phone number is required for mobile money payment.');
    }

    let totalAmount = 0;
    const purchaseIds = [];
    const titles = [];
    const merchantReference = `CART_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    for (const item of normalizedItems) {
      const kind = item?.kind === 'provider_material' ? 'provider_material' : 'movie';
      const childProfile = kind === 'provider_material' && item?.childProfileId
        ? await findOwnedChildProfile(strapi, ctx.state.user.id, item.childProfileId)
        : null;
      if (kind === 'provider_material' && item?.childProfileId && !childProfile) continue;
      const target = await findPurchaseTarget(strapi, {
        movieId: kind === 'movie' ? item?.id : null,
        providerMaterialId: kind === 'provider_material' ? item?.id : null,
      });
      if (!target) continue;

      const existing = await strapi.documents('api::purchase.purchase').findMany({
        filters: kind === 'provider_material'
          ? {
              buyer: { id: ctx.state.user.id },
              providerMaterial: { id: target.id },
              status: 'completed',
              ...(childProfile ? { childProfile: { id: childProfile.id } } : {}),
            }
          : { buyer: { id: ctx.state.user.id }, movie: { id: target.id }, status: 'completed' },
      });
      if (existing && existing.length > 0) continue;

      const amount = kind === 'provider_material'
        ? target.amount
        : getMovieAmount(settings, target.movie, null);

      if (kind === 'provider_material' && amount <= 0) continue;

      totalAmount += amount;
      titles.push(target.title);

      const purchase = await strapi.documents('api::purchase.purchase').create({
        data: {
          movie: kind === 'movie' ? target.id : null,
          providerMaterial: kind === 'provider_material' ? target.id : null,
          buyer: ctx.state.user.id,
          childProfile: childProfile?.id || null,
          amount,
          paymentMethod: paymentMethod || activeGateway,
          paymentPhone: paymentPhone || '',
          transactionId: merchantReference,
          status: 'pending',
        },
      });
      purchaseIds.push(purchase.documentId);
    }

    if (totalAmount === 0) {
      return ctx.badRequest('No new items to purchase');
    }

    const frontendUrl = process.env.FRONTEND_URL;

    try {
      const user = ctx.state.user;
      const nameParts = (user.fullName || user.username || '').split(' ');
      const paymentResult = await submitPayment(strapi, {
        merchantReference,
        amount: totalAmount,
        description: `Mr.Flix - ${titles.length} title(s): ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '...' : ''}`,
        callbackUrl: `${frontendUrl}/payment/callback`,
        ipnId,
        paymentPhone: paymentPhone || '',
        billingAddress: {
          email: user.email || '',
          phone: paymentPhone || '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        },
      });

      const updateData = buildGatewayTrackingUpdate(paymentResult);

      for (const pid of purchaseIds) {
        await strapi.documents('api::purchase.purchase').update({
          documentId: pid,
          data: updateData,
        });
      }

      return {
        data: {
          purchaseIds,
          transactionId: merchantReference,
          gateway: paymentResult.gateway,
          redirect_url: paymentResult.redirect_url || null,
          order_tracking_id: paymentResult.order_tracking_id || null,
          reference: paymentResult.reference || null,
          paymentStatus: paymentResult.status || null,
          totalAmount,
        },
      };
    } catch (err) {
      strapi.log.error('Bulk payment order failed:', err);
      for (const pid of purchaseIds) {
        await strapi.documents('api::purchase.purchase').update({
          documentId: pid,
          data: { status: 'failed' },
        });
      }
      return ctx.badRequest('Payment initiation failed. Please try again.');
    }
  },

  /**
   * Check the status of a pending purchase by transactionId.
   * If still pending, actively queries Pesapal to see if payment completed
   * (handles case where IPN hasn't arrived, e.g. localhost or network issues).
   */
  async checkStatus(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { transactionId } = ctx.params;
    if (!transactionId) {
      return ctx.badRequest('Missing transactionId');
    }

    let purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        transactionId,
        buyer: { id: ctx.state.user.id },
      },
      populate: {
        movie: true,
        providerMaterial: true,
        childProfile: true,
        buyer: true,
        product: { populate: { seller: true } },
      },
    });

    if (!purchases || purchases.length === 0) {
      strapi.log.info(`[checkStatus] No purchases found for txn=${transactionId} user=${ctx.state.user.id}`);
      return ctx.notFound('Purchase not found');
    }

    // If any purchase is still pending, check payment gateway directly
    const hasPending = purchases.some(p => p.status === 'pending');
    const trackingId = purchases[0].pesapalTrackingId;
    const dgRef = purchases[0].dgatewayReference;
    const yoRef = purchases[0].yoReference;
    const gateway = resolveRecordGateway(purchases[0]);
    strapi.log.info(`[checkStatus] txn=${transactionId} found=${purchases.length} hasPending=${hasPending} pesapalId=${trackingId || 'none'} dgRef=${dgRef || 'none'} yoRef=${yoRef || 'none'} gateway=${gateway}`);
    if (hasPending && (trackingId || dgRef || yoRef || gateway === 'airtel')) {
      try {
        const result = await checkPaymentStatus(strapi, {
          pesapalTrackingId: trackingId,
          dgatewayReference: dgRef,
          yoReference: yoRef,
          merchantReference: transactionId,
          gateway,
        });
        strapi.log.info(`[checkStatus] Gateway says: ${result.status}`);

        if (result.status === 'completed') {
          const data = {};
          if (trackingId) data.pesapalTrackingId = trackingId;
          if (result.paymentMethod) data.paymentMethod = result.paymentMethod;
          if (result.confirmationCode) data.airtelReference = result.confirmationCode;
          await markPurchasesCompleted(strapi, purchases, data);
          purchases = await strapi.documents('api::purchase.purchase').findMany({
            filters: { transactionId, buyer: { id: ctx.state.user.id } },
            populate: {
              movie: true,
              providerMaterial: true,
              childProfile: true,
              buyer: true,
              product: { populate: { seller: true } },
            },
          });
        } else if (result.status === 'failed') {
          for (const p of purchases) {
            if (p.status === 'pending') {
              await strapi.documents('api::purchase.purchase').update({
                documentId: p.documentId,
                data: { status: 'failed' },
              });
            }
          }
          purchases = await strapi.documents('api::purchase.purchase').findMany({
            filters: { transactionId, buyer: { id: ctx.state.user.id } },
            populate: {
              movie: true,
              providerMaterial: true,
              childProfile: true,
              buyer: true,
              product: { populate: { seller: true } },
            },
          });
        }
      } catch (err) {
        strapi.log.warn('[checkStatus] Payment gateway query failed:', err.message);
      }
    }

    return {
      data: purchases.map(p => ({
        id: p.documentId,
        status: p.status,
        itemInfo: buildPurchaseInfo(p),
        movieInfo: p.movie ? { id: p.movie.documentId || p.movie.id, title: p.movie.title, type: p.movie.type } : null,
      })),
    };
  },

  async incrementDownload(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { movieId } = ctx.request.body.data || ctx.request.body;

    if (!movieId) {
      return ctx.badRequest('Missing movieId');
    }

    const purchases = await strapi.documents('api::purchase.purchase').findMany({
      filters: {
        buyer: ctx.state.user.id,
        movie: { documentId: movieId },
        status: 'completed',
      },
      sort: { createdAt: 'desc' },
      limit: 1,
    });

    if (!purchases || purchases.length === 0) {
      return ctx.notFound('Purchase record not found for this user and movie');
    }

    const purchase = purchases[0];

    const updated = await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: {
        downloadCount: (purchase.downloadCount || 0) + 1,
      },
    });

    return { data: updated };
  },
}));
