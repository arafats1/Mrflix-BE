module.exports = ({ env }) => {
  const storageProvider = env('STORAGE_PROVIDER', 'cloudflare').toLowerCase();
  const isBackblaze = storageProvider === 'backblaze';

  const accessKeyId = isBackblaze ? env('B2_ACCESS_KEY_ID') : env('CF_ACCESS_KEY_ID');
  const secretAccessKey = isBackblaze ? env('B2_ACCESS_SECRET') : env('CF_ACCESS_SECRET');
  const endpoint = isBackblaze ? env('B2_ENDPOINT') : env('CF_ENDPOINT');
  const bucket = isBackblaze ? env('B2_BUCKET', 'Mrflix') : env('CF_BUCKET', 'mrflix');
  const baseUrl = isBackblaze ? env('B2_PUBLIC_URL') : env('CF_PUBLIC_URL');

  return {
    upload: {
      config: {
        provider: '@strapi/provider-upload-aws-s3',
        providerOptions: {
          s3Options: {
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
            region: 'auto',
            endpoint,
            params: {
              Bucket: bucket,
            },
            forcePathStyle: true,
          },
          baseUrl,
        },
        sizeLimit: 5 * 1024 * 1024 * 1024,
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
          allowedFields: ['phone', 'fullName', 'religion', 'isParent', 'accountType', 'providerType', 'schoolName', 'educationLevel', 'educationLevelOther'],
        },
      },
    },
  };
};
