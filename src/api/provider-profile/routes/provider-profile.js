'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/provider-profile/me',
      handler: 'provider-profile.updateMe',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/provider-profile/verification',
      handler: 'provider-profile.submitSellerVerification',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/provider-profile/location',
      handler: 'provider-profile.updateSellerLocation',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/provider-profile/verifications',
      handler: 'provider-profile.listSellerVerifications',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/provider-profile/verifications/:id',
      handler: 'provider-profile.reviewSellerVerification',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/provider-profile/teachers/:id/subscribe',
      handler: 'provider-profile.toggleTeacherSubscription',
      config: { auth: false },
    },
  ],
};
