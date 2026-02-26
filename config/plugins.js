module.exports = ({ env }) => ({
  // Cloudflare R2 Upload Provider (S3-compatible, cheapest CDN option)
  // R2 Pricing: $0.015/GB storage, $0.00 egress (free!)
  // Cloudflare CDN delivers from edge nodes globally (Nairobi closest to Uganda)
  upload: {
    config: {
      provider: '@strapi/provider-upload-aws-s3',
      providerOptions: {
        s3Options: {
          credentials: {
            accessKeyId: env('CF_ACCESS_KEY_ID'),
            secretAccessKey: env('CF_ACCESS_SECRET'),
          },
          region: 'auto',
          endpoint: env('CF_ENDPOINT'),
          params: {
            Bucket: env('CF_BUCKET'),
          },
          forcePathStyle: true,
        },
        baseUrl: env('CF_PUBLIC_URL'),
      },
      sizeLimit: 5 * 1024 * 1024 * 1024, // 5GB max for video uploads
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
  // Users & Permissions
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '7d',
      },
      register: {
        allowedFields: ['phone', 'fullName'],
      },
    },
  },
});
