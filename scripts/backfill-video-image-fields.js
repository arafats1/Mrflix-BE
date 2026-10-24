#!/usr/bin/env node
'use strict';

/**
 * Clear video URLs that were stored in product image fields.
 *
 * Video-only listings used to fall back to the video's own URL for
 * `featuredImage` / `productVideoThumbnailUrl`, so any client that trusts those
 * fields downloads the whole upload to draw a thumbnail — one affected listing
 * carries a 36MB .mov, and it sits in the first row of the children market.
 * The seller editor no longer writes these; this fixes the existing rows.
 *
 * The dry run reads the public products API, so it works against production
 * before the admin route below has been deployed. `--apply` needs
 * POST /api/products/admin/clear-video-image-fields and a full-access token.
 *
 * Usage:
 *   npm run backfill:video-image-fields -- --dry-run
 *   npm run backfill:video-image-fields -- --dry-run --url=https://movo.ara44.com
 *
 *   MARKETPLACE_IMAGES_URL=https://movo.ara44.com \
 *   MARKETPLACE_IMAGES_TOKEN=<full-access-api-token> \
 *   npm run backfill:video-image-fields -- --apply
 *
 *   npm run backfill:video-image-fields -- --apply --documentId=o8ggifv80u8swvoms2wxq6vg
 */

const path = require('node:path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const { isVideoUrl, isImageUrl } = require('../src/utils/marketplace-image-processing');

// The stored image-url columns. `featuredImageCard` / `featuredImageThumbnail`
// are derived from `featuredImage` by the clients, so there is nothing to fix.
const IMAGE_FIELDS = ['featuredImage', 'productVideoThumbnailUrl'];
const DEFAULT_BASE_URL = 'https://movo.ara44.com';

function parseArgs(argv) {
  const args = { apply: false, documentId: null, pageSize: 100, url: null, token: null };

  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw.startsWith('--documentId=')) args.documentId = raw.split('=')[1] || null;
    else if (raw.startsWith('--page-size=')) args.pageSize = Number.parseInt(raw.split('=')[1], 10) || 100;
    else if (raw.startsWith('--url=')) args.url = raw.split('=')[1];
    else if (raw.startsWith('--token=')) args.token = raw.split('=')[1];
  }

  return args;
}

function getConfig(args) {
  const baseUrl = String(
    args.url || process.env.MARKETPLACE_IMAGES_URL || process.env.MARKETPLACE_IMAGE_REMOTE_URL || DEFAULT_BASE_URL,
  ).trim().replace(/\/$/, '');
  const token = String(
    args.token || process.env.MARKETPLACE_IMAGES_TOKEN || process.env.MARKETPLACE_IMAGE_API_TOKEN || '',
  ).trim();

  if (args.apply && !token) {
    throw new Error('--apply needs an API token. Set MARKETPLACE_IMAGES_TOKEN or pass --token=');
  }

  return { baseUrl, token };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  return text ? JSON.parse(text) : {};
}

function authHeaders(token, json = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

/** Walk every page of /api/products, which the dry run can read unauthenticated. */
async function loadAllProducts(config, pageSize) {
  const products = [];
  let page = 1;
  let pageCount = 1;

  do {
    const url = new URL(`${config.baseUrl}/api/products`);
    url.searchParams.set('sort', 'createdAt:desc');
    url.searchParams.set('pagination[page]', String(page));
    url.searchParams.set('pagination[pageSize]', String(pageSize));
    url.searchParams.set('pagination[withCount]', 'true');

    const response = await fetchJson(url.toString(), { headers: authHeaders(config.token) });
    const batch = Array.isArray(response.data) ? response.data : [];
    products.push(...batch);

    pageCount = Math.max(response.meta?.pagination?.pageCount || 1, 1);
    if (!batch.length) break;
    page += 1;
  } while (page <= pageCount);

  return products;
}

/** The replacement for a cleared field: a real image from the product, or nothing. */
function findReplacementImage(product) {
  const variants = Array.isArray(product.images) ? product.images : [];
  return variants
    .map((variant) => (typeof variant === 'string' ? variant : variant?.card || variant?.original || variant?.thumbnail))
    .find((url) => isImageUrl(url)) || '';
}

function planChanges(products) {
  const changes = [];

  for (const product of products) {
    const offending = IMAGE_FIELDS.filter((field) => isVideoUrl(product[field]));
    if (!offending.length) continue;

    changes.push({
      id: product.id,
      documentId: product.documentId,
      name: product.name || '(untitled)',
      fields: offending,
      before: Object.fromEntries(offending.map((field) => [field, product[field]])),
      replacement: findReplacementImage(product),
      imageCount: Array.isArray(product.images) ? product.images.length : 0,
    });
  }

  return changes;
}

function basename(url) {
  return String(url || '').split('?')[0].split('/').pop();
}

function report(changes, scanned) {
  console.log(`[backfill-video-image-fields] Scanned ${scanned} products, ${changes.length} need fixing.\n`);

  if (!changes.length) {
    console.log('Nothing to do — no image field holds a video URL.');
    return;
  }

  for (const change of changes) {
    const action = change.replacement
      ? `set to ${basename(change.replacement)} (from images[])`
      : 'cleared (listing has no still image — clients draw their placeholder)';

    console.log(`${change.name}  [id ${change.id} · doc ${change.documentId}]`);
    console.log(`  images[] entries: ${change.imageCount}`);
    for (const field of change.fields) {
      console.log(`  ${field}`);
      console.log(`      was:  ${basename(change.before[field])}`);
      console.log(`      now:  ${action}`);
    }
    console.log('');
  }

  const cleared = changes.filter((change) => !change.replacement).length;
  console.log(`Summary: ${changes.length} products, ${changes.length - cleared} get a replacement image, ${cleared} get the field cleared.`);
}

async function apply(config, documentId) {
  const url = new URL(`${config.baseUrl}/api/products/admin/clear-video-image-fields`);
  const body = { dryRun: false, ...(documentId ? { documentId } : {}) };

  const response = await fetchJson(url.toString(), {
    method: 'POST',
    headers: authHeaders(config.token, true),
    body: JSON.stringify(body),
  });

  const data = response.data || {};
  console.log(`[backfill-video-image-fields] Applied: ${data.updated} of ${data.affected} affected (${data.scanned} scanned).`);
  for (const change of data.changes || []) {
    console.log(`  ${change.name} [doc ${change.documentId}] — ${change.fields.join(', ')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig(args);

  console.log(`[backfill-video-image-fields] Target: ${config.baseUrl} | ${args.apply ? 'APPLY' : 'dry-run'}\n`);

  if (args.apply) {
    await apply(config, args.documentId);
    return;
  }

  const products = args.documentId
    ? [(await fetchJson(
        `${config.baseUrl}/api/products/${encodeURIComponent(args.documentId)}`,
        { headers: authHeaders(config.token) },
      )).data].filter(Boolean)
    : await loadAllProducts(config, args.pageSize);

  const changes = planChanges(products);
  report(changes, products.length);

  if (changes.length) {
    console.log('\nRe-run with --apply (and a full-access token) to write these changes.');
  }
}

main().catch((error) => {
  console.error(`[backfill-video-image-fields] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
