module.exports = {
  routes: [
    { method: 'GET', path: '/storage-folders', handler: 'storage-folder.find', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-folders/:id', handler: 'storage-folder.findOne', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-folders', handler: 'storage-folder.create', config: { auth: { scope: [] } } },
    { method: 'PUT', path: '/storage-folders/:id', handler: 'storage-folder.update', config: { auth: { scope: [] } } },
    { method: 'DELETE', path: '/storage-folders/:id', handler: 'storage-folder.delete', config: { auth: { scope: [] } } },
  ],
};
