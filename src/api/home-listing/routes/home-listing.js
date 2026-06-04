module.exports = {
  routes: [
    { method: 'GET', path: '/homes/listings', handler: 'home-listing.findPublic', config: { auth: false } },
    { method: 'GET', path: '/homes/listings/:id', handler: 'home-listing.findOnePublic', config: { auth: false } },
    { method: 'GET', path: '/homes/me/listings', handler: 'home-listing.myListings', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/homes/listings', handler: 'home-listing.createListing', config: { auth: { scope: [] } } },
    { method: 'PUT', path: '/homes/listings/:id', handler: 'home-listing.updateListing', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/homes/kyc', handler: 'home-listing.submitKyc', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/homes/kyc/me', handler: 'home-listing.myKyc', config: { auth: { scope: [] } } },
    { method: 'PUT', path: '/homes/kyc/:id/review', handler: 'home-listing.reviewKyc', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/homes/listings/:id/unlock-contact', handler: 'home-listing.unlockContact', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/homes/listings/:id/bookings', handler: 'home-listing.createBooking', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/homes/bookings/me', handler: 'home-listing.myBookings', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/homes/listings/:id/save', handler: 'home-listing.toggleSave', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/homes/saves/me', handler: 'home-listing.mySaves', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/homes/payments/check-status', handler: 'home-listing.checkPaymentStatus', config: { auth: { scope: [] } } },
  ],
};