module.exports = {
  routes: [
    { method: 'GET', path: '/storage-files', handler: 'storage-file.find', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-files/:id', handler: 'storage-file.findOne', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files', handler: 'storage-file.create', config: { auth: { scope: [] } } },
    { method: 'PUT', path: '/storage-files/:id', handler: 'storage-file.update', config: { auth: { scope: [] } } },
    { method: 'DELETE', path: '/storage-files/:id', handler: 'storage-file.delete', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/bulk-delete', handler: 'storage-file.bulkDelete', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/trash', handler: 'storage-file.trash', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/restore', handler: 'storage-file.restore', config: { auth: { scope: [] } } },
    { method: 'DELETE', path: '/storage-files/empty-trash', handler: 'storage-file.emptyTrash', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/storage-files/usage/stats', handler: 'storage-file.storageUsage', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/upload-url', handler: 'storage-file.getUploadUrl', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/upload/initiate', handler: 'storage-file.initiateUpload', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/upload/part', handler: 'storage-file.getPartUrl', config: { auth: { scope: [] } } },
    { method: 'POST', path: '/storage-files/upload/complete', handler: 'storage-file.completeUpload', config: { auth: { scope: [] } } },
  ],
};
