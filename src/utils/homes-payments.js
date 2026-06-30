'use strict';

const CONTACT_UID = 'api::home-contact-unlock.home-contact-unlock';
const BOOKING_UID = 'api::home-booking.home-booking';
const LISTING_UID = 'api::home-listing.home-listing';
const { notifyHomesBookingConfirmed } = require('./homes-notifications');

async function activateHomesPaymentByFilter(strapi, filter, paymentMethod) {
  const now = new Date().toISOString();

  const unlocks = await strapi.entityService.findMany(CONTACT_UID, { filters: filter, limit: 100 });
  for (const unlock of (unlocks || [])) {
    if (unlock.status !== 'active') {
      await strapi.entityService.update(CONTACT_UID, unlock.id, {
        data: { status: 'active', unlockedAt: now, ...(paymentMethod ? { paymentMethod } : {}) },
      });
      strapi.log.info(`[Homes Payment] Contact unlock ${unlock.id} activated`);
    }
  }

  const bookings = await strapi.entityService.findMany(BOOKING_UID, {
    filters: filter,
    populate: { listing: { fields: ['id', 'bookingCount'] } },
    limit: 100,
  });
  for (const booking of (bookings || [])) {
    if (booking.status !== 'confirmed') {
      await strapi.entityService.update(BOOKING_UID, booking.id, {
        data: { status: 'confirmed', ...(paymentMethod ? { paymentMethod } : {}) },
      });
      if (booking.listing?.id) {
        await strapi.entityService.update(LISTING_UID, booking.listing.id, {
          data: { bookingCount: Number(booking.listing.bookingCount || 0) + 1 },
        }).catch((error) => strapi.log.warn(`[Homes Payment] Could not increment booking count: ${error.message}`));
      }
      strapi.log.info(`[Homes Payment] Booking ${booking.id} confirmed`);
      notifyHomesBookingConfirmed(strapi, booking.id).catch((error) => {
        strapi.log.warn(`[Homes Payment] Booking notification failed: ${error.message}`);
      });
    }
  }
}

async function failHomesPaymentByFilter(strapi, filter) {
  const unlocks = await strapi.entityService.findMany(CONTACT_UID, { filters: filter, limit: 100 });
  for (const unlock of (unlocks || [])) {
    if (unlock.status === 'pending') {
      await strapi.entityService.update(CONTACT_UID, unlock.id, { data: { status: 'failed' } });
    }
  }

  const bookings = await strapi.entityService.findMany(BOOKING_UID, { filters: filter, limit: 100 });
  for (const booking of (bookings || [])) {
    if (booking.status === 'pending') {
      await strapi.entityService.update(BOOKING_UID, booking.id, { data: { status: 'failed' } });
    }
  }
}

module.exports = { activateHomesPaymentByFilter, failHomesPaymentByFilter };