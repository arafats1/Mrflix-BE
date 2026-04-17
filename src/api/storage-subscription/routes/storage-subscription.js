module.exports = {
  routes: [
    { method: 'GET', path: '/storage-subscriptions/me', handler: 'storage-subscription.me', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-subscriptions', handler: 'storage-subscription.find', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-subscriptions/pricing', handler: 'storage-subscription.pricing', config: { policies: [] } },
    { method: 'POST', path: '/storage-subscriptions', handler: 'storage-subscription.create', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-subscriptions/check-status', handler: 'storage-subscription.checkStatus', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-subscriptions/grant', handler: 'storage-subscription.grant', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-subscriptions/revoke', handler: 'storage-subscription.revoke', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-subscriptions/admin/stats', handler: 'storage-subscription.adminStats', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-subscriptions/admin/users', handler: 'storage-subscription.adminUsers', config: { auth: { scope: [] } } },
  ],
};
