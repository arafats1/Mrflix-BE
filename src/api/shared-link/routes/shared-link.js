module.exports = {
  routes: [
    { method: 'POST', path: '/shared-links', handler: 'shared-link.create', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/shared-links', handler: 'shared-link.find', config: { auth: { scope: [] } } },
    { method: 'DELETE', path: '/shared-links/:id', handler: 'shared-link.delete', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/shared-links/access/:token', handler: 'shared-link.access', config: { policies: [] } },
  ],
};
