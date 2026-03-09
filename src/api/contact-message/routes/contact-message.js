'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/contact-messages',
      handler: 'contact-message.find',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/contact-messages',
      handler: 'contact-message.create',
      config: {
        auth: false, // Anyone can submit a contact form
      },
    },
    {
      method: 'PUT',
      path: '/contact-messages/:id',
      handler: 'contact-message.update',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/contact-messages/:id',
      handler: 'contact-message.delete',
      config: { policies: [] },
    },
  ],
};
