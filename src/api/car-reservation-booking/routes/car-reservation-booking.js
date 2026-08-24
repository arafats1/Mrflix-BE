'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/car-reservation-bookings/booked-product-ids',
      handler: 'car-reservation-booking.bookedProductIds',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-reservation-bookings',
      handler: 'car-reservation-booking.create',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/car-reservation-bookings/:id/status',
      handler: 'car-reservation-booking.updateStatus',
      config: { auth: false },
    },
  ],
};
