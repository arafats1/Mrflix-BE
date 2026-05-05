const corsOrigins = [
  process.env.FRONTEND_URL,
  'https://www.mymovokids.com',
  'https://mymovokids.com',
  ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
].filter(Boolean);

const activeStoragePublicUrl = (
  (process.env.STORAGE_PROVIDER || 'backblaze').toLowerCase() === 'backblaze'
    ? process.env.B2_PUBLIC_URL
    : process.env.CF_PUBLIC_URL
) || process.env.B2_PUBLIC_URL || process.env.CF_PUBLIC_URL || '';

module.exports = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://image.tmdb.org',
            activeStoragePublicUrl,
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            activeStoragePublicUrl,
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-MrKeyp-Space-Owner', 'x-mrkeyp-space-owner', 'X-MrKeyp-Client', 'x-mrkeyp-client'],
      keepHeaderOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: '5gb',
      jsonLimit: '10mb',
      textLimit: '10mb',
      formidable: {
        maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
      },
    },
  },
  {
    name: 'strapi::session',
    config: {
      proxy: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
    },
  },
  'strapi::favicon',
  'strapi::public',
];
