#!/usr/bin/env node
'use strict';

/**
 * Optimize marketplace product images against a remote Strapi production API.
 *
 * Mode A (server-side, recommended after deploy):
 *   Calls POST /api/products/admin/optimize-images on the server so DB + B2
 *   credentials stay on Railway. Paginates until every product is processed.
 *
 * Mode B (client-side fallback):
 *   Downloads images locally, re-encodes with sharp, uploads to B2 using
 *   credentials from .env, then PUTs image variants via the admin endpoint.
 *
 * Usage:
 *   MARKETPLACE_IMAGES_URL=https://mrflix-be-production.up.railway.app \
 *   MARKETPLACE_IMAGES_TOKEN=<full-access-api-token> \
 *   npm run optimize:marketplace-images:remote -- --force --documentId=p6r56w317b0v101clh0wh6vm
 *
 *   npm run optimize:marketplace-images:remote -- --dry-run --limit=5
 *   npm run optimize:marketplace-images:remote -- --force --client
 */

const path = require('node:path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const {
  normalizeImageEntry,
  entryNeedsProcessing,
  compressToTarget,
  renderVariant,
  uploadBuffer,
  getStorage,
  fetchBuffer,
  inferFeaturedIndex,
  TARGET_ORIGINAL_BYTES,
  VARIANT_SPECS,
  OPTIMIZED_ORIGINAL_SPEC,
} = require('../src/utils/marketplace-image-processing');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    client: false,
    limit: null,
    documentId: null,
    pageSize: 25,
  };

  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
    else if (raw === '--client') args.client = true;
    else if (raw.startsWith('--limit=')) args.limit = Number.parseInt(raw.split('=')[1], 10) || null;
    else if (raw.startsWith('--documentId=')) args.documentId = raw.split('=')[1] || null;
    else if (raw.startsWith('--page-size=')) args.pageSize = Number.parseInt(raw.split('=')[1], 10) || 25;
    else if (raw.startsWith('--url=')) args.url = raw.split('=')[1];
    else if (raw.startsWith('--token=')) args.token = raw.split('=')[1];
  }

  return args;
}

function getConfig(args) {
  const baseUrl = String(args.url || process.env.MARKETPLACE_IMAGES_URL || process.env.MARKETPLACE_IMAGE_REMOTE_URL || '').trim().replace(/\/$/, '');
  const token = String(args.token || process.env.MARKETPLACE_IMAGES_TOKEN || process.env.MARKETPLACE_IMAGE_API_TOKEN || '').trim();

  if (!baseUrl) throw new Error('Missing base URL. Set MARKETPLACE_IMAGES_URL or pass --url=');
  if (!token) throw new Error('Missing API token. Set MARKETPLACE_IMAGES_TOKEN or pass --token=');

  return { baseUrl, token };
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

function authHeaders(token, json = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function loadProductsPage(config, page, pageSize) {
  const url = new URL(`${config.baseUrl}/api/products`);
  url.searchParams.set('pagination[page]', String(page));
  url.searchParams.set('pagination[pageSize]', String(pageSize));
  url.searchParams.set('pagination[withCount]', 'true');

  const response = await fetchJson(url.toString(), { headers: authHeaders(config.token) });
  return {
    products: Array.isArray(response.data) ? response.data : [],
    meta: response.meta?.pagination || {},
  };
}

async function findProductByDocumentId(config, documentId) {
  const response = await fetchJson(
    `${config.baseUrl}/api/products/${encodeURIComponent(documentId)}`,
    { headers: authHeaders(config.token) },
  );
  return response.data || null;
}

async function callServerOptimize(config, { force, documentId, page, pageSize }) {
  const url = new URL(`${config.baseUrl}/api/products/admin/optimize-images`);
  if (force) url.searchParams.set('force', 'true');
  if (documentId) url.searchParams.set('documentId', documentId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));

  return fetchJson(url.toString(), {
    method: 'POST',
    headers: authHeaders(config.token, true),
    body: JSON.stringify({ force, documentId, page, pageSize }),
  });
}

async function updateProductImages(config, documentId, payload) {
  return fetchJson(`${config.baseUrl}/api/products/admin/${encodeURIComponent(documentId)}/images`, {
    method: 'PUT',
    headers: authHeaders(config.token, true),
    body: JSON.stringify({ data: payload }),
  });
}

function getCandidateProducts(products, options) {
  let list = products.filter((product) => Array.isArray(product.images) && product.images.length > 0);

  if (options.documentId) {
    list = list.filter((product) => String(product.documentId || '') === String(options.documentId));
  }

  if (!options.force) {
    list = list.filter((product) => {
      const variants = product.images.map(normalizeImageEntry).filter(Boolean);
      return variants.some((entry) => entryNeedsProcessing(entry, false));
    });
  }

  if (options.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  return list;
}

async function processProductClientSide(config, product, options, storage) {
  const identityKey = product.documentId || product.id;
  const entries = product.images.map(normalizeImageEntry).filter(Boolean);
  const nextVariants = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const next = {
      original: entry.original,
      card: entry.card || null,
      thumbnail: entry.thumbnail || null,
    };

    const missing = Object.keys(VARIANT_SPECS).filter((name) => options.force || !next[name]);
    const shouldOptimizeOriginal = entryNeedsProcessing(entry, options.force);

    if (!missing.length && !shouldOptimizeOriginal) {
      next.card = next.card || next.original;
      next.thumbnail = next.thumbnail || next.card || next.original;
      nextVariants.push(next);
      continue;
    }

    const sourceUrl = next.original;
    let sourceBuffer = await fetchBuffer(sourceUrl);

    if (sourceBuffer.length > TARGET_ORIGINAL_BYTES) {
      const optimized = await compressToTarget(sourceBuffer, TARGET_ORIGINAL_BYTES);
      if (optimized && optimized.length < sourceBuffer.length) {
        const key = `${OPTIMIZED_ORIGINAL_SPEC.folder}/${identityKey}/${index + 1}.webp`;
        next.original = await uploadBuffer(storage, optimized, key);
        sourceBuffer = optimized;
      }
    }

    for (const variantName of missing) {
      const spec = VARIANT_SPECS[variantName];
      const key = `${spec.folder}/${identityKey}/${index + 1}.webp`;
      const variantBuffer = await renderVariant(sourceBuffer, spec);
      next[variantName] = await uploadBuffer(storage, variantBuffer, key);
    }

    next.card = next.card || next.original;
    next.thumbnail = next.thumbnail || next.card || next.original;
    nextVariants.push(next);
  }

  const featuredIndex = inferFeaturedIndex(nextVariants, product.featuredImage);
  const featuredVariant = nextVariants[featuredIndex] || nextVariants[0] || null;

  const payload = {
    images: nextVariants,
    featuredImage: featuredVariant?.original || product.featuredImage || null,
  };

  if (!options.dryRun) {
    await updateProductImages(config, product.documentId, payload);
  }

  return payload;
}

async function runServerMode(config, options) {
  let page = 1;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  let total = null;

  while (true) {
    if (options.dryRun) {
      const { products, meta } = options.documentId
        ? { products: [await findProductByDocumentId(config, options.documentId)].filter(Boolean), meta: { pageCount: 1 } }
        : await loadProductsPage(config, page, options.pageSize);

      if (total === null) total = options.documentId ? products.length : (meta.total || products.length);
      const candidates = getCandidateProducts(products, options);
      for (const product of candidates) {
        console.log(`[optimize-remote] Would optimize ${product.name} (#${product.documentId})`);
      }
      totalProcessed += candidates.length;
      if (options.documentId || page >= (meta.pageCount || 1)) break;
      page += 1;
      if (options.limit && totalProcessed >= options.limit) break;
      continue;
    }

    const result = await callServerOptimize(config, {
      force: options.force,
      documentId: options.documentId,
      page: options.documentId ? 1 : page,
      pageSize: options.pageSize,
    });

    const stats = result.data || {};
    if (total === null) total = stats.total || 0;
    totalUpdated += stats.updated || 0;
    totalSkipped += stats.skipped || 0;
    totalFailed += stats.failed || 0;
    totalProcessed += stats.processed || 0;

    console.log(`[optimize-remote] Page ${stats.page || page}: ${stats.updated} updated, ${stats.skipped} skipped, ${stats.failed} failed`);
    if (Array.isArray(stats.errors) && stats.errors.length > 0) {
      for (const err of stats.errors) {
        console.error(`[optimize-remote]   - ${err.name}: ${err.error}`);
      }
    }

    if (options.documentId) break;
    if ((stats.processed || 0) === 0) break;
    if (page * options.pageSize >= total) break;
    page += 1;
    if (options.limit && totalProcessed >= options.limit) break;
  }

  console.log(`[optimize-remote] Server mode done. ${totalUpdated} updated, ${totalSkipped} skipped, ${totalFailed} failed (${totalProcessed} processed).`);
}

async function runClientMode(config, options) {
  const storage = getStorage();
  if (!storage.publicUrl) {
    throw new Error('B2_PUBLIC_URL is not configured in .env — required for client-side uploads.');
  }

  let page = 1;
  let updated = 0;
  let failed = 0;
  let processed = 0;

  while (true) {
    const products = options.documentId
      ? [await findProductByDocumentId(config, options.documentId)].filter(Boolean)
      : (await loadProductsPage(config, page, options.pageSize)).products;

    const candidates = getCandidateProducts(products, options);
    if (candidates.length === 0 && !options.documentId) {
      if (products.length === 0) break;
      page += 1;
      continue;
    }

    for (const product of candidates) {
      const label = `${product.name || 'Untitled'} (#${product.documentId})`;
      try {
        if (options.dryRun) {
          console.log(`[optimize-remote] Would optimize ${label}`);
          processed += 1;
          continue;
        }

        const before = JSON.stringify(product.images);
        const payload = await processProductClientSide(config, product, options, storage);
        const changed = JSON.stringify(payload.images) !== before;
        if (changed) {
          updated += 1;
          const firstOriginal = payload.images?.[0]?.original || '';
          console.log(`[optimize-remote] Optimized ${label} -> ${firstOriginal.includes('/optimized/') ? 'optimized URL' : 'updated'}`);
        } else {
          console.log(`[optimize-remote] No changes for ${label}`);
        }
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[optimize-remote] Failed ${label}: ${error.message}`);
      }

      if (options.limit && processed >= options.limit) break;
    }

    if (options.documentId || (options.limit && processed >= options.limit)) break;
    if (products.length < options.pageSize) break;
    page += 1;
  }

  console.log(`[optimize-remote] Client mode done. ${updated} updated, ${failed} failed (${processed} processed).`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig(options);

  console.log(`[optimize-remote] Target: ${config.baseUrl}${options.force ? ' | force' : ''}${options.dryRun ? ' | dry-run' : ''}${options.client ? ' | client-side' : ' | server-side'}`);

  if (options.client) {
    await runClientMode(config, options);
    return;
  }

  try {
    await runServerMode(config, options);
  } catch (error) {
    if (/not found|404|Forbidden|Unauthorized/i.test(error.message)) {
      console.warn(`[optimize-remote] Server endpoint unavailable (${error.message}). Re-run with --client after deploying the admin routes.`);
      throw error;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`[optimize-remote] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
