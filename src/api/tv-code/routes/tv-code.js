module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/tv-codes/generate',
      handler: 'tv-code.generate',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/tv-codes/generate-for-tv',
      handler: 'tv-code.generateForTV',
      config: {
        policies: [],
        auth: false, // TV is not authenticated
      },
    },
    {
      method: 'POST',
      path: '/tv-codes/claim',
      handler: 'tv-code.claim',
      config: {
        policies: [],
        // Requires auth — web user must be logged in
      },
    },
    {
      method: 'POST',
      path: '/tv-codes/poll',
      handler: 'tv-code.poll',
      config: {
        policies: [],
        auth: false, // TV is not authenticated
      },
    },
    {
      method: 'POST',
      path: '/tv-codes/verify',
      handler: 'tv-code.verify',
      config: {
        policies: [],
        auth: false, // TV app is not authenticated yet
      },
    },
  ],
};
