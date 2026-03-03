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
      path: '/tv-codes/verify',
      handler: 'tv-code.verify',
      config: {
        policies: [],
        auth: false, // TV app is not authenticated yet
      },
    },
  ],
};
