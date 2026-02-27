module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/upload-url',
      handler: 'upload-url.getPresignedUrl',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/upload-url/complete',
      handler: 'upload-url.completeMultipartUpload',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/upload-url/initiate',
      handler: 'upload-url.initiateMultipartUpload',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/upload-url/part',
      handler: 'upload-url.getPartPresignedUrl',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/upload-url/abort',
      handler: 'upload-url.abortMultipartUpload',
      config: {
        policies: [],
      },
    },
  ],
};
