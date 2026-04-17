module.exports = {
  routes: [
    { method: 'POST', path: '/account-invitations', handler: 'account-invitation.create', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/account-invitations/me', handler: 'account-invitation.mine', config: { auth: { scope: [] } } },
    { method: 'GET', path: '/account-invitations/preview/:token', handler: 'account-invitation.preview', config: { policies: [] } },
    { method: 'POST', path: '/account-invitations/accept/:token', handler: 'account-invitation.accept', config: { auth: { scope: [] } } },
    { method: 'DELETE', path: '/account-invitations/:id', handler: 'account-invitation.delete', config: { auth: { scope: [] } } },
  ],
};