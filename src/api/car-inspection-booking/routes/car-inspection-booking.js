'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/car-inspection-bookings',
      handler: 'car-inspection-booking.create',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/car-inspection-bookings/mine',
      handler: 'car-inspection-booking.mine',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/car-inspection-bookings/:id/status',
      handler: 'car-inspection-booking.updateStatus',
      config: { auth: false },
    },
  ],
};
