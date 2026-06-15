#!/usr/bin/env node
'use strict';

/**
 * Backfill lightweight image variants for existing marketplace products.
 *
 * Reuses the same logic the API uses on upload (src/utils/marketplace-image-processing.js),
 * so it generates card/thumbnail webp variants and re-encodes any heavy
 * original (> 500KB) down to the target size for products still missing
 * optimized images. Use --force to re-optimize already-processed products
 * (recommended once after lowering the size target).
 *
 * Usage:
 *   npm run optimize:marketplace-images -- --dry-run
 *   npm run optimize:marketplace-images -- --limit=50
 *   npm run optimize:marketplace-images -- --force
 */

const { compileStrapi, createStrapi } = require('@strapi/core');
const { processProductImages } = require('../src/utils/marketplace-image-processing');

function parseArgs(argv) {
  const args = { dryRun: false, force: false, limit: null, documentId: null };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--limit=')) args.limit = Number.parseInt(raw.split('=')[1], 10) || null;
    else if (raw.startsWith('--documentId=')) args.documentId = raw.split('=')[1] || null;
  }
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const products = await strapi.db.query('api::product.product').findMany({
      select: ['id', 'documentId', 'name'],
      orderBy: { updatedAt: 'desc' },
      ...(options.documentId ? { where: { documentId: options.documentId }, limit: 1 } : {}),
      ...(options.limit && !options.documentId ? { limit: options.limit } : {}),
    });

    console.log(`[optimize-marketplace-images] Found ${products.length} product(s).${options.dryRun ? ' (dry run)' : ''}`);

    let updated = 0;
    let failed = 0;

    for (const product of products) {
      const label = `${product.name || 'Untitled'} (#${product.id}${product.documentId ? `/${product.documentId}` : ''})`;
      try {
        if (options.dryRun) {
          console.log(`[optimize-marketplace-images] Would process ${label}`);
          continue;
        }

        const changed = await processProductImages(strapi, { documentId: product.documentId, id: product.id }, { force: options.force });
        if (changed) {
          updated += 1;
          console.log(`[optimize-marketplace-images] Optimized ${label}`);
        }
      } catch (error) {
        failed += 1;
        console.error(`[optimize-marketplace-images] Failed for ${label}: ${error.message}`);
      }
    }

    console.log(`[optimize-marketplace-images] Completed. ${updated} updated, ${failed} failed.`);
  } finally {
    await strapi.destroy();
  }
}

main().catch((error) => {
  console.error(`[optimize-marketplace-images] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
