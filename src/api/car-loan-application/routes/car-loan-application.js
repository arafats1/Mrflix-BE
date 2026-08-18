'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/car-loan-applications',
      handler: 'car-loan-application.create',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/car-loan-applications/mine',
      handler: 'car-loan-application.mine',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/car-loan-applications/:id/mine',
      handler: 'car-loan-application.findMine',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-loan-applications/:id/crb-fee',
      handler: 'car-loan-application.payCrbFee',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-loan-applications/:id/credit-check',
      handler: 'car-loan-application.runCreditCheck',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-loan-applications/:id/offer',
      handler: 'car-loan-application.respondToOffer',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/car-loan-applications/:id/agreement',
      handler: 'car-loan-application.agreement',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-loan-applications/:id/documents',
      handler: 'car-loan-application.uploadDocuments',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cars/admin/overview',
      handler: 'car-loan-application.adminOverview',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/car-loan-applications/:id/status',
      handler: 'car-loan-application.updateStatus',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/car-loan-applications/:id/documents-ready',
      handler: 'car-loan-application.markDocumentsReady',
      config: { auth: false },
    },
  ],
};
