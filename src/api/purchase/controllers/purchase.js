'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { submitPayment, checkPaymentStatus, getActiveGateway } = require('../../../utils/payment-gateway');
const { recordProviderMaterialSale } = require('../../../utils/provider-material-sales');

async function findPurchaseTarget(strapi, { movieId, providerMaterialId, productId }) {
  if (productId) {
    const product = await strapi.documents('api::product.product').findOne({
      documentId: productId,
    });

    if (!product) return null;

    return {
      kind: 'product',
      id: product.id,
      documentId: product.documentId,
      title: product.name,
      amount: Number(product.priceUGX || 0),
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

  return null;
}

function formatBuyerContact(user) {
  if (!user) return '';

  const phone = typeof user.phone === 'string' ? user.phone.trim() : '';
  if (phone) return phone;

  const email = typeof user.email === 'string' ? user.email.trim() : '';
  return email.endsWith('@phone.movokids.local') ? '' : email;
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

    await strapi.documents('api::purchase.purchase').update({
      documentId: purchase.documentId,
      data: updateData,
    });
  }
}

function getMovieAmount(settings, movie, seasonNumber) {
  if (movie.type === 'series') {
    return settings?.seriesPrice ?? 5000;
  }

  return settings?.moviePrice ?? 2000;
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
        providerMaterial: { populate: '*' },
        product: { populate: '*' },
        buyer: { populate: '*' },
        childProfile: true,
      }
      : {
        movie: { populate: '*' },
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

    return {
      data: sellerPurchases.map((purchase) => ({
        ...purchase,
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
      paymentMethod,
      paymentPhone,
      seasonNumber,
      isPayOnDelivery,
      deliveryAddress,
      deliveryPhone,
      contactName,
    } = ctx.request.body.data || ctx.request.body;
    const childProfileId = (ctx.request.body.data || ctx.request.body || {}).childProfileId;

    if (!movieId && !providerMaterialId && !productId) {
      return ctx.badRequest('Missing required field: movieId, providerMaterialId or productId');
    }

    const target = await findPurchaseTarget(strapi, { movieId, providerMaterialId, productId });
    if (!target) {
      return ctx.notFound(productId ? 'Product not found' : providerMaterialId ? 'Provider material not found' : 'Movie not found');
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
      const validPurchases = existing.filter(p => !p.expiresAt || new Date(p.expiresAt) > now);

      if (validPurchases.length > 0) {
        return ctx.badRequest('You already own this ' + (seasonNumber ? `season ${seasonNumber}` : target.kind === 'provider_material' ? 'material' : 'movie'));
      }
    }

    const settings = await strapi.entityService.findMany('api::site-setting.site-setting');
    const amount = target.kind === 'provider_material' || target.kind === 'product'
      ? target.amount
      : getMovieAmount(settings, target.movie, seasonNumber);

    if ((target.kind === 'provider_material' || target.kind === 'product') && amount <= 0) {
      return ctx.badRequest('This item is not available for purchase.');
    }

    const merchantReference = `PUR_${ctx.state.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const description = target.kind === 'provider_material' || target.kind === 'product'
      ? target.title
      : seasonNumber
        ? `${target.movie.title} - Season ${seasonNumber}`
        : target.movie.title;
    const manualSupplierPayment = target.kind === 'product' && paymentMethod === 'manual_supplier_payment';
    const payOnDeliveryOrder = target.kind === 'product' && (paymentMethod === 'pay_on_delivery' || isPayOnDelivery);
    const requiresGateway = !manualSupplierPayment && !payOnDeliveryOrder;
    let activeGateway = null;

    if (requiresGateway) {
      activeGateway = await getActiveGateway(strapi);
      const ipnId = settings?.pesapalIpnId;

      if (activeGateway === 'pesapal' && !ipnId) {
        strapi.log.error('Pesapal IPN ID not configured.');
        return ctx.badRequest('Payment system not configured. Please contact support.');
      }

      if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !paymentPhone) {
        return ctx.badRequest('Phone number is required for mobile money payment.');
      }
    }

    const frontendUrl = process.env.FRONTEND_URL;
    const callbackUrl = `${frontendUrl}/payment/callback`;

    const purchaseData = {
      movie: target.kind === 'movie' ? target.id : null,
      providerMaterial: target.kind === 'provider_material' ? target.id : null,
      product: target.kind === 'product' ? target.id : null,
      buyer: ctx.state.user.id,
      childProfile: childProfile?.id || null,
      amount,
      paymentMethod: manualSupplierPayment ? 'manual_supplier_payment' : payOnDeliveryOrder ? 'pay_on_delivery' : (paymentMethod || activeGateway),
      paymentPhone: paymentPhone || '',
      transactionId: merchantReference,
      status: 'pending',
      seasonNumber: (target.kind === 'movie' && target.movie.type === 'series' && seasonNumber) ? seasonNumber : null,
      isPayOnDelivery: !!payOnDeliveryOrder,
      deliveryAddress: deliveryAddress || '',
      deliveryPhone: deliveryPhone || '',
      contactName: contactName || '',
    };

    const purchase = await strapi.documents('api::purchase.purchase').create({
      data: purchaseData,
    });

    if (manualSupplierPayment || payOnDeliveryOrder) {
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

      const updateData = {};
      if (paymentResult.gateway === 'pesapal') {
        updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      } else if (paymentResult.gateway === 'dgateway') {
        updateData.dgatewayReference = paymentResult.reference;
      } else if (paymentResult.gateway === 'yo') {
        updateData.yoReference = paymentResult.reference;
      }

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
    if ((activeGateway === 'dgateway' || activeGateway === 'yo') && !paymentPhone) {
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

      const updateData = {};
      if (paymentResult.gateway === 'pesapal') {
        updateData.pesapalTrackingId = paymentResult.order_tracking_id;
      } else if (paymentResult.gateway === 'dgateway') {
        updateData.dgatewayReference = paymentResult.reference;
      } else if (paymentResult.gateway === 'yo') {
        updateData.yoReference = paymentResult.reference;
      }

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
      populate: { movie: true, providerMaterial: true, childProfile: true },
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
    strapi.log.info(`[checkStatus] txn=${transactionId} found=${purchases.length} hasPending=${hasPending} pesapalId=${trackingId || 'none'} dgRef=${dgRef || 'none'} yoRef=${yoRef || 'none'}`);
    if (hasPending && (trackingId || dgRef || yoRef)) {
      try {
        const result = await checkPaymentStatus(strapi, {
          pesapalTrackingId: trackingId,
          dgatewayReference: dgRef,
          yoReference: yoRef,
          merchantReference: transactionId,
          gateway: yoRef ? 'yo' : dgRef ? 'dgateway' : 'pesapal',
        });
        strapi.log.info(`[checkStatus] Gateway says: ${result.status}`);

        if (result.status === 'completed') {
          const data = {};
          if (trackingId) data.pesapalTrackingId = trackingId;
          if (result.paymentMethod) data.paymentMethod = result.paymentMethod;
          await markPurchasesCompleted(strapi, purchases, data);
          purchases = await strapi.documents('api::purchase.purchase').findMany({
            filters: { transactionId, buyer: { id: ctx.state.user.id } },
            populate: { movie: true, providerMaterial: true, childProfile: true },
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
            populate: { movie: true, providerMaterial: true, childProfile: true },
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
