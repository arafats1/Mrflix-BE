module.exports = {
  routes: [
    { method: 'GET', path: '/marketplace-promotions/pricing', handler: 'marketplace-promotion.pricing', config: { policies: [] } },
    { method: 'GET', path: '/marketplace-promotions/mine', handler: 'marketplace-promotion.mine', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/marketplace-promotions', handler: 'marketplace-promotion.create', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/marketplace-promotions/check-status', handler: 'marketplace-promotion.checkStatus', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/marketplace-promotions/admin/revenue', handler: 'marketplace-promotion.adminRevenue', config: { auth: { scope: [] } } },
  ],
};
