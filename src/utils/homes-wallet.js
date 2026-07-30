'use strict';

const WALLET_UID = 'api::home-wallet.home-wallet';
const PAYOUT_UID = 'api::home-payout.home-payout';
const BOOKING_UID = 'api::home-booking.home-booking';
const { payoutEligibleAtFromCheckIn } = require('./homes-policies');

async function getOrCreateHostWallet(strapi, hostId) {
  if (!hostId) return null;
  const rows = await strapi.entityService.findMany(WALLET_UID, {
    filters: { host: { id: hostId } },
    populate: { host: { fields: ['id', 'username', 'fullName', 'phone'] } },
    limit: 1,
  });
  if (rows?.[0]) return rows[0];
  return strapi.entityService.create(WALLET_UID, {
    data: {
      host: hostId,
      unsettledUGX: 0,
      pendingPayoutUGX: 0,
      lifetimeEarnedUGX: 0,
      lifetimePaidOutUGX: 0,
    },
    populate: { host: { fields: ['id', 'username', 'fullName', 'phone'] } },
  });
}

function shapeWallet(wallet, eligibleUGX = 0) {
  if (!wallet) return null;
  const unsettled = Math.max(0, Number(wallet.unsettledUGX || 0));
  const pending = Math.max(0, Number(wallet.pendingPayoutUGX || 0));
  const eligible = Math.max(0, Math.min(eligibleUGX, unsettled - pending));
  return {
    id: wallet.id,
    unsettledUGX: unsettled,
    pendingPayoutUGX: pending,
    eligiblePayoutUGX: eligible,
    lifetimeEarnedUGX: Math.max(0, Number(wallet.lifetimeEarnedUGX || 0)),
    lifetimePaidOutUGX: Math.max(0, Number(wallet.lifetimePaidOutUGX || 0)),
    host: wallet.host ? {
      id: wallet.host.id,
      username: wallet.host.username || '',
      fullName: wallet.host.fullName || '',
      phone: wallet.host.phone || '',
    } : null,
  };
}

async function computeEligiblePayoutUGX(strapi, hostId) {
  if (!hostId) return 0;
  const now = new Date().toISOString();
  const rows = await strapi.entityService.findMany(BOOKING_UID, {
    filters: {
      host: { id: hostId },
      status: { $in: ['confirmed', 'checked_in', 'checked_out', 'completed'] },
      walletCredited: true,
      payoutEligibleAt: { $lte: now },
    },
    fields: ['id', 'hostEarningsUGX', 'amountUGX'],
    limit: 500,
  });
  return (rows || []).reduce((sum, row) => sum + Math.max(0, Number(row.hostEarningsUGX || row.amountUGX || 0)), 0);
}

/** Fix bookings that were charged the mistaken 10% default instead of 5%. */
async function reconcileMistakenTenPercentFees(strapi, hostId) {
  if (!hostId) return;
  const rows = await strapi.entityService.findMany(BOOKING_UID, {
    filters: { host: { id: hostId }, walletCredited: true },
    fields: ['id', 'amountUGX', 'hostEarningsUGX', 'platformFeeUGX'],
    limit: 200,
  });
  let walletDelta = 0;
  for (const row of (rows || [])) {
    const amount = Math.max(0, Number(row.amountUGX || 0));
    if (amount <= 0) continue;
    const tenPercentFee = Math.round(amount * 0.1);
    const fivePercentFee = Math.round(amount * 0.05);
    const currentFee = Number(row.platformFeeUGX || 0);
    const currentHost = Number(row.hostEarningsUGX || 0);
    if (currentFee !== tenPercentFee || currentHost !== amount - tenPercentFee) continue;
    const nextHost = amount - fivePercentFee;
    const delta = nextHost - currentHost;
    if (delta === 0) continue;
    await strapi.entityService.update(BOOKING_UID, row.id, {
      data: { platformFeeUGX: fivePercentFee, hostEarningsUGX: nextHost },
    });
    walletDelta += delta;
  }
  if (walletDelta === 0) return;
  const wallet = await getOrCreateHostWallet(strapi, hostId);
  if (!wallet) return;
  await strapi.entityService.update(WALLET_UID, wallet.id, {
    data: {
      unsettledUGX: Math.max(0, Number(wallet.unsettledUGX || 0) + walletDelta),
      lifetimeEarnedUGX: Math.max(0, Number(wallet.lifetimeEarnedUGX || 0) + walletDelta),
    },
  });
  strapi.log.info(`[Homes Wallet] Reconciled 10%→5% fees for host ${hostId}: +${walletDelta} UGX`);
}

async function creditHostWalletForBooking(strapi, bookingId) {
  const booking = await strapi.entityService.findOne(BOOKING_UID, bookingId, {
    populate: { host: { fields: ['id'] }, listing: { fields: ['id', 'title'] } },
  });
  if (!booking || booking.walletCredited) return null;
  if (!['confirmed', 'checked_in', 'checked_out', 'completed'].includes(booking.status)) return null;
  const hostId = booking.host?.id;
  if (!hostId) return null;

  const hostEarnings = Math.max(0, Number(booking.hostEarningsUGX || booking.amountUGX || 0));
  if (hostEarnings <= 0) {
    await strapi.entityService.update(BOOKING_UID, booking.id, {
      data: {
        walletCredited: true,
        payoutEligibleAt: payoutEligibleAtFromCheckIn(booking.checkIn),
      },
    });
    return null;
  }

  const wallet = await getOrCreateHostWallet(strapi, hostId);
  await strapi.entityService.update(WALLET_UID, wallet.id, {
    data: {
      unsettledUGX: Math.max(0, Number(wallet.unsettledUGX || 0)) + hostEarnings,
      lifetimeEarnedUGX: Math.max(0, Number(wallet.lifetimeEarnedUGX || 0)) + hostEarnings,
    },
  });
  await strapi.entityService.update(BOOKING_UID, booking.id, {
    data: {
      walletCredited: true,
      payoutEligibleAt: booking.payoutEligibleAt || payoutEligibleAtFromCheckIn(booking.checkIn),
    },
  });
  strapi.log.info(`[Homes Wallet] Credited ${hostEarnings} UGX to host ${hostId} for booking ${booking.id}`);
  return wallet;
}

async function reverseHostWalletForBooking(strapi, booking, keepAmountUGX = 0) {
  if (!booking?.walletCredited || !booking.host?.id) return;
  const hostEarnings = Math.max(0, Number(booking.hostEarningsUGX || booking.amountUGX || 0));
  const reverse = Math.max(0, hostEarnings - Math.max(0, Number(keepAmountUGX || 0)));
  if (reverse <= 0) return;
  const wallet = await getOrCreateHostWallet(strapi, booking.host.id);
  await strapi.entityService.update(WALLET_UID, wallet.id, {
    data: {
      unsettledUGX: Math.max(0, Number(wallet.unsettledUGX || 0) - reverse),
      lifetimeEarnedUGX: Math.max(0, Number(wallet.lifetimeEarnedUGX || 0) - reverse),
    },
  });
}

async function requestHostPayout(strapi, hostId, amountUGX, payoutPhone) {
  const wallet = await getOrCreateHostWallet(strapi, hostId);
  const eligible = await computeEligiblePayoutUGX(strapi, hostId);
  const unsettled = Math.max(0, Number(wallet.unsettledUGX || 0));
  const pending = Math.max(0, Number(wallet.pendingPayoutUGX || 0));
  const maxRequest = Math.max(0, Math.min(eligible, unsettled - pending));
  const amount = Math.max(0, Number(amountUGX || 0));
  if (amount < 1000) throw new Error('Minimum payout is UGX 1,000');
  if (amount > maxRequest) throw new Error(`You can request up to UGX ${maxRequest.toLocaleString()} right now`);

  const payout = await strapi.entityService.create(PAYOUT_UID, {
    data: {
      host: hostId,
      wallet: wallet.id,
      amountUGX: amount,
      status: 'pending',
      payoutPhone: String(payoutPhone || '').trim().slice(0, 40),
      requestedAt: new Date().toISOString(),
    },
  });
  await strapi.entityService.update(WALLET_UID, wallet.id, {
    data: { pendingPayoutUGX: pending + amount },
  });
  return payout;
}

async function markPayoutPaid(strapi, payoutId, adminUserId, { paymentReference, adminNote } = {}) {
  const payout = await strapi.entityService.findOne(PAYOUT_UID, payoutId, {
    populate: { wallet: true, host: { fields: ['id'] } },
  });
  if (!payout) throw new Error('Payout not found');
  if (payout.status === 'paid') return payout;
  if (payout.status === 'rejected') throw new Error('Rejected payouts cannot be marked paid');

  const wallet = payout.wallet || (payout.host?.id ? await getOrCreateHostWallet(strapi, payout.host.id) : null);
  if (!wallet) throw new Error('Host wallet not found');

  const amount = Math.max(0, Number(payout.amountUGX || 0));
  await strapi.entityService.update(WALLET_UID, wallet.id, {
    data: {
      unsettledUGX: Math.max(0, Number(wallet.unsettledUGX || 0) - amount),
      pendingPayoutUGX: Math.max(0, Number(wallet.pendingPayoutUGX || 0) - amount),
      lifetimePaidOutUGX: Math.max(0, Number(wallet.lifetimePaidOutUGX || 0)) + amount,
    },
  });
  return strapi.entityService.update(PAYOUT_UID, payout.id, {
    data: {
      status: 'paid',
      paidAt: new Date().toISOString(),
      reviewer: adminUserId || null,
      paymentReference: String(paymentReference || '').trim().slice(0, 120),
      adminNote: String(adminNote || '').trim().slice(0, 1000),
    },
  });
}

async function rejectPayout(strapi, payoutId, adminUserId, adminNote = '') {
  const payout = await strapi.entityService.findOne(PAYOUT_UID, payoutId, { populate: { wallet: true } });
  if (!payout) throw new Error('Payout not found');
  if (payout.status !== 'pending') throw new Error('Only pending payouts can be rejected');
  if (payout.wallet?.id) {
    await strapi.entityService.update(WALLET_UID, payout.wallet.id, {
      data: {
        pendingPayoutUGX: Math.max(0, Number(payout.wallet.pendingPayoutUGX || 0) - Number(payout.amountUGX || 0)),
      },
    });
  }
  return strapi.entityService.update(PAYOUT_UID, payout.id, {
    data: {
      status: 'rejected',
      reviewer: adminUserId || null,
      adminNote: String(adminNote || '').trim().slice(0, 1000),
    },
  });
}

module.exports = {
  WALLET_UID,
  PAYOUT_UID,
  getOrCreateHostWallet,
  shapeWallet,
  computeEligiblePayoutUGX,
  reconcileMistakenTenPercentFees,
  creditHostWalletForBooking,
  reverseHostWalletForBooking,
  requestHostPayout,
  markPayoutPaid,
  rejectPayout,
};
