const corsOrigins = [
  process.env.FRONTEND_URL,
  process.env.MRKEYP_URL,
  process.env.PUBLIC_URL,
  'https://www.movobrands.com',
  'https://movobrands.com',
  'https://www.mymovokids.com',
  'https://mymovokids.com',
  'https://movo-kids.vercel.app',
  'https://mrflix.app',
  'https://www.mrflix.app',
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
  'global::airtel-callback-head',
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
      origin: Array.from(new Set([
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'https://www.mymovokids.com',
        'https://mymovokids.com',
        'https://movo-kids.vercel.app',
        'https://mrflix-ug.vercel.app',
        ...corsOrigins,
      ])),
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
