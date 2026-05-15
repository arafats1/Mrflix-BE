#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

const VARIANT_SPECS = {
  card: { folder: 'product-images/card', maxDimension: 960, quality: 78 },
  thumbnail: { folder: 'product-images/thumbnail', maxDimension: 320, quality: 72 },
};

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  const hashIndex = trimmed.indexOf('#');
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex).trimEnd() : trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = parseEnvValue(value);
    }
  }
}

loadEnvFile(path.resolve(__dirname, '..', '.env'));

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    limit: null,
    productId: null,
    documentId: null,
    source: null,
    remoteUrl: null,
    apiToken: null,
  };

  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--limit=')) args.limit = Number.parseInt(raw.split('=')[1], 10) || null;
    else if (raw.startsWith('--product=')) args.productId = Number.parseInt(raw.split('=')[1], 10) || null;
    else if (raw.startsWith('--documentId=')) args.documentId = raw.split('=')[1] || null;
    else if (raw.startsWith('--source=')) args.source = raw.split('=')[1] || null;
    else if (raw.startsWith('--remote-url=')) args.remoteUrl = raw.split('=')[1] || null;
    else if (raw.startsWith('--api-token=')) args.apiToken = raw.split('=')[1] || null;
    else if (raw === '--help' || raw === '-h') args.help = true;
  }

  return args;
}

function printHelp() {
  console.log([
    'Regenerate marketplace product image variants for existing products.',
    '',
    'Usage:',
    '  npm run regenerate:marketplace-images -- --dry-run --limit=5',
    '  npm run regenerate:marketplace-images -- --product=12',
    '  npm run regenerate:marketplace-images -- --documentId=abc123',
    '  npm run regenerate:marketplace-images -- --force --source=entrepreneur',
    '  MARKETPLACE_IMAGE_REMOTE_URL=https://mrflix-be-production.up.railway.app MARKETPLACE_IMAGE_API_TOKEN=*** npm run regenerate:marketplace-images -- --dry-run --limit=5',
    '',
    'Options:',
    '  --dry-run        List and process candidates without uploading or updating DB',
    '  --force          Regenerate card/thumbnail variants even if they already exist',
    '  --limit=N        Only process the first N matching products',
    '  --product=ID     Process a single numeric product id',
    '  --documentId=ID  Process a single Strapi document id',
    '  --source=VALUE   Filter by marketplaceSource (core or entrepreneur)',
    '  --remote-url     Run against a remote Strapi base URL instead of local Strapi',
    '  --api-token      Bearer token for remote updates (or use MARKETPLACE_IMAGE_API_TOKEN)',
    '',
    'Safety:',
    '  - Existing original image URLs are preserved by default.',
    '  - The script only adds or refreshes card/thumbnail variants.',
    '  - Start with --dry-run before enabling writes on production.',
  ].join('\n'));
}

function getRuntimeMode(options) {
  return options.remoteUrl || options.apiToken || process.env.MARKETPLACE_IMAGE_REMOTE_URL || process.env.MARKETPLACE_IMAGE_API_TOKEN
    ? 'remote'
    : 'local';
}

function getRemoteConfig(options) {
  const baseUrl = String(options.remoteUrl || process.env.MARKETPLACE_IMAGE_REMOTE_URL || '').trim().replace(/\/$/, '');
  const apiToken = String(options.apiToken || process.env.MARKETPLACE_IMAGE_API_TOKEN || '').trim();

  if (!baseUrl) {
    throw new Error('Remote mode requires --remote-url or MARKETPLACE_IMAGE_REMOTE_URL');
  }

  return { baseUrl, apiToken };
}

function getStorage() {
  const provider = (process.env.STORAGE_PROVIDER || 'backblaze').toLowerCase();
  const isBackblaze = provider === 'backblaze';

  return {
    s3: new S3Client({
      region: isBackblaze ? (process.env.B2_REGION || 'us-east-005') : 'auto',
      endpoint: isBackblaze ? process.env.B2_ENDPOINT : process.env.CF_ENDPOINT,
      credentials: {
        accessKeyId: isBackblaze ? process.env.B2_ACCESS_KEY_ID : process.env.CF_ACCESS_KEY_ID,
        secretAccessKey: isBackblaze ? process.env.B2_ACCESS_SECRET : process.env.CF_ACCESS_SECRET,
      },
      forcePathStyle: true,
    }),
    bucket: isBackblaze ? (process.env.B2_BUCKET || 'Mrflix') : (process.env.CF_BUCKET || 'mrflix'),
    publicUrl: (isBackblaze ? process.env.B2_PUBLIC_URL : process.env.CF_PUBLIC_URL) || '',
  };
}

function normalizeImageEntry(entry) {
  if (!entry) return null;

  if (typeof entry === 'string') {
    return {
      original: entry,
      card: null,
      thumbnail: null,
    };
  }

  if (typeof entry === 'object') {
    const original = entry.original || entry.url || null;
    if (!original) return null;

    return {
      original,
      card: entry.card || entry.medium || null,
      thumbnail: entry.thumbnail || entry.thumb || null,
    };
  }

  return null;
}

function hasFullVariantSet(entry) {
  return !!(entry && entry.original && entry.card && entry.thumbnail);
}

function inferFeaturedIndex(variants, featuredImage) {
  if (!Array.isArray(variants) || variants.length === 0) return 0;
  const featured = String(featuredImage || '').trim();
  if (!featured) return 0;

  const index = variants.findIndex((variant) => (
    variant.original === featured || variant.card === featured || variant.thumbnail === featured
  ));

  return index >= 0 ? index : 0;
}

function makeAbsoluteUrl(url, baseUrl) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith('/')) return url;
  return `${String(baseUrl || '').replace(/\/$/, '')}${url}`;
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Request failed: ${response.status}`);
  }

  return data;
}

async function renderVariant(buffer, spec) {
  return sharp(buffer)
    .rotate()
    .resize({
      width: spec.maxDimension,
      height: spec.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: spec.quality })
    .toBuffer();
}

async function uploadVariant(storage, buffer, key) {
  await storage.s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${storage.publicUrl.replace(/\/$/, '')}/${key}`;
}

function buildRemoteHeaders(remote, { json = false } = {}) {
  const headers = {};

  if (remote.apiToken) {
    headers.Authorization = `Bearer ${remote.apiToken}`;
  }

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function loadRemoteProducts(remote) {
  const response = await fetchJson(`${remote.baseUrl}/api/products?sort=updatedAt:desc`, {
    headers: buildRemoteHeaders(remote),
  });

  return Array.isArray(response.data) ? response.data : [];
}

async function updateRemoteProduct(remote, product, payload) {
  const identifier = product.documentId || product.id;
  return fetchJson(`${remote.baseUrl}/api/products/${encodeURIComponent(String(identifier))}`, {
    method: 'PUT',
    headers: buildRemoteHeaders(remote, { json: true }),
    body: JSON.stringify({ data: payload }),
  });
}

function getLocalBaseUrl(strapi) {
  return strapi.config.get('server.absoluteUrl') || `http://localhost:${strapi.config.get('server.port') || 1337}`;
}

function getUploadNames(options, variant) {
  return Object.keys(VARIANT_SPECS).filter((name) => options.force || !variant?.[name]);
}

async function buildNextVariant({ product, variant, imageIndex, sourceUrl, storage, options }) {
  const nextVariant = {
    original: variant.original,
    card: variant.card || null,
    thumbnail: variant.thumbnail || null,
  };

  const missingVariants = getUploadNames(options, nextVariant);
  if (missingVariants.length === 0) {
    return nextVariant;
  }

  if (options.dryRun) {
    for (const name of missingVariants) {
      nextVariant[name] = nextVariant[name] || `(generated ${name} variant)`;
    }
    return nextVariant;
  }

  const sourceBuffer = await fetchBuffer(sourceUrl);

  for (const variantName of missingVariants) {
    const spec = VARIANT_SPECS[variantName];
    const key = `${spec.folder}/${product.documentId || product.id}/${imageIndex + 1}.webp`;
    const buffer = await renderVariant(sourceBuffer, spec);
    nextVariant[variantName] = await uploadVariant(storage, buffer, key);
  }

  return nextVariant;
}

function buildPayload(product, nextVariants) {
  const featuredIndex = inferFeaturedIndex(nextVariants, product.featuredImage);
  const featuredVariant = nextVariants[featuredIndex] || nextVariants[0] || null;

  return {
    images: nextVariants,
    featuredImage: featuredVariant?.original || product.featuredImage || null,
  };
}

function getCandidateProducts(products, options) {
  let list = Array.isArray(products) ? products : [];

  if (options.productId) {
    list = list.filter((product) => Number(product.id) === Number(options.productId));
  }

  if (options.documentId) {
    list = list.filter((product) => String(product.documentId || '') === String(options.documentId));
  }

  if (options.source) {
    list = list.filter((product) => String(product.marketplaceSource || 'core') === options.source);
  }

  if (!options.force) {
    list = list.filter((product) => {
      const variants = Array.isArray(product.images) ? product.images.map(normalizeImageEntry).filter(Boolean) : [];
      if (variants.length === 0 && product.featuredImage) return true;
      return variants.some((variant) => !hasFullVariantSet(variant));
    });
  }

  if (options.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  return list;
}

async function createLocalContext() {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  return {
    label: 'local Strapi',
    getBaseUrl() {
      return getLocalBaseUrl(strapi);
    },
    async loadProducts() {
      return strapi.db.query('api::product.product').findMany({
        select: ['id', 'documentId', 'name', 'images', 'featuredImage', 'marketplaceSource', 'updatedAt'],
        orderBy: { updatedAt: 'desc' },
      });
    },
    async updateProduct(product, payload) {
      return strapi.db.query('api::product.product').update({
        where: { id: product.id },
        data: payload,
      });
    },
    async destroy() {
      await strapi.destroy();
    },
  };
}

async function createRemoteContext(options) {
  const remote = getRemoteConfig(options);

  return {
    label: `remote ${remote.baseUrl}`,
    getBaseUrl() {
      return remote.baseUrl;
    },
    async loadProducts() {
      return loadRemoteProducts(remote);
    },
    async updateProduct(product, payload) {
      return updateRemoteProduct(remote, product, payload);
    },
    async destroy() {},
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const mode = getRuntimeMode(options);
  const context = mode === 'remote'
    ? await createRemoteContext(options)
    : await createLocalContext();

  try {
    const products = await context.loadProducts();

    const candidates = getCandidateProducts(products, options);
    console.log(`[marketplace-images] Running in ${context.label}. Found ${candidates.length} product(s) to process${options.dryRun ? ' (dry run)' : ''}.`);

    if (candidates.length === 0) return;

    const storage = options.dryRun ? null : getStorage();
    let updatedCount = 0;
    let failedCount = 0;

    for (const product of candidates) {
      const label = `${product.name || 'Untitled'} (#${product.id}${product.documentId ? `/${product.documentId}` : ''})`;
      try {
        const sourceVariants = Array.isArray(product.images)
          ? product.images.map(normalizeImageEntry).filter(Boolean)
          : [];

        if (sourceVariants.length === 0 && product.featuredImage) {
          sourceVariants.push(normalizeImageEntry(product.featuredImage));
        }

        if (sourceVariants.length === 0) {
          console.log(`[marketplace-images] Skipping ${label}: no source images found.`);
          continue;
        }

        const featuredIndex = inferFeaturedIndex(sourceVariants, product.featuredImage);
        const nextVariants = [];
        const baseUrl = context.getBaseUrl();

        for (let index = 0; index < sourceVariants.length; index += 1) {
          const variant = sourceVariants[index];
          const sourceUrl = makeAbsoluteUrl(variant.original, baseUrl);
          if (!sourceUrl) {
            throw new Error(`Image ${index + 1} has no usable source URL`);
          }

          nextVariants.push(await buildNextVariant({
            product,
            variant,
            imageIndex: index,
            sourceUrl,
            storage,
            options,
          }));
        }

        const payload = buildPayload(product, nextVariants);

        console.log(`[marketplace-images] ${options.dryRun ? 'Would update' : 'Updating'} ${label}`);

        if (!options.dryRun) {
          await context.updateProduct(product, payload);
        }

        updatedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`[marketplace-images] Failed for ${label}: ${error.message}`);
      }
    }

    console.log(`[marketplace-images] Completed. ${updatedCount} updated, ${failedCount} failed.`);
  } finally {
    await context.destroy();
  }
}

main().catch((error) => {
  console.error(`[marketplace-images] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});