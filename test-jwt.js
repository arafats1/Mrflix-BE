const strapi = require('@strapi/strapi')({ distDir: './dist' });
strapi.start().then(async () => {
  const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: 1 });
  console.log('JWT:', jwt);
  process.exit(0);
}).catch(console.error);
