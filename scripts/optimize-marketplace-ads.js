#!/usr/bin/env node
'use strict';

/**
 * Backfill: compress existing marketplace ad images (carousel / sidebar / top).
 *
 * Many ad creatives were uploaded as multi-MB JPEGs, which makes the
 * marketplace carousel slow. This script re-uploads each heavy ad image through
 * the admin upload endpoint (which now compresses to <=1600px webp) and updates
 * the ad to point at the new lightweight URL.
 *
 * It talks to the API over HTTP using a full-access Strapi API token, so it does
 * NOT need direct storage/DB credentials — safe to run against production from
 * anywhere. Images are compressed locally with sharp before upload, so it works
 * even before the compressing upload endpoint is deployed.
 *
 * Usage:
 *   MARKETPLACE_ADS_URL=https://mrflix-be-production.up.railway.app \
 *   MARKETPLACE_ADS_TOKEN=<full-access-api-token> \
 *   node scripts/optimize-marketplace-ads.js [--dry-run] [--threshold-kb=400]
 */

const path = require('node:path');
const sharp = require('sharp');

function parseArgs(argv) {
  const args = { dryRun: false, thresholdKb: 400 };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw.startsWith('--threshold-kb=')) {
      const n = Number.parseInt(raw.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) args.thresholdKb = n;
    } else if (raw.startsWith('--url=')) args.url = raw.split('=')[1];
    else if (raw.startsWith('--token=')) args.token = raw.split('=')[1];
  }
  return args;
}

function getConfig(args) {
  const baseUrl = String(args.url || process.env.MARKETPLACE_ADS_URL || '').trim().replace(/\/$/, '');
  const token = String(args.token || process.env.MARKETPLACE_ADS_TOKEN || '').trim();

  if (!baseUrl) throw new Error('Missing base URL. Set MARKETPLACE_ADS_URL or pass --url=');
  if (!token) throw new Error('Missing admin token. Set MARKETPLACE_ADS_TOKEN or pass --token=');

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

async function loadAds(config) {
  const data = await fetchJson(`${config.baseUrl}/api/marketplace-ads/admin`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return Array.isArray(data.data) ? data.data : [];
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

async function compressImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

async function uploadBuffer(config, buffer, sourceUrl) {
  const form = new FormData();
  const baseName = (path.basename(new URL(sourceUrl).pathname) || 'ad-image').replace(/\.[^.]+$/, '');
  form.append('file', new Blob([buffer], { type: 'image/webp' }), `${baseName}.webp`);

  const response = await fetch(`${config.baseUrl}/api/marketplace-ads/admin/upload-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Upload failed: ${response.status}`);
  }
  return data.url;
}

async function updateAdImage(config, ad, newImageUrl) {
  return fetchJson(`${config.baseUrl}/api/marketplace-ads/admin/${encodeURIComponent(ad.id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        title: ad.title,
        subtitle: ad.subtitle,
        eyebrow: ad.eyebrow,
        ctaLabel: ad.ctaLabel,
        linkUrl: ad.linkUrl,
        imageUrl: newImageUrl,
        backgroundColor: ad.backgroundColor,
        textColor: ad.textColor,
        accentColor: ad.accentColor,
        placement: ad.placement,
        status: ad.status,
        priority: ad.priority,
        startsAt: ad.startsAt,
        endsAt: ad.endsAt,
      },
    }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig(args);
  const thresholdBytes = args.thresholdKb * 1024;

  console.log(`[optimize-ads] Target: ${config.baseUrl} | threshold: ${args.thresholdKb}KB${args.dryRun ? ' | DRY RUN' : ''}`);

  const ads = await loadAds(config);
  console.log(`[optimize-ads] Loaded ${ads.length} ad(s).`);

  let optimized = 0;
  let skipped = 0;
  let failed = 0;

  for (const ad of ads) {
    const label = `${ad.placement} #${ad.id} (${ad.title || 'Untitled'})`;
    if (!ad.imageUrl) { skipped += 1; continue; }

    try {
      const { buffer, contentType } = await downloadImage(ad.imageUrl);
      const isWebp = /\.webp(\?|$)/i.test(ad.imageUrl) || contentType.includes('webp');

      // Already a small webp -> nothing to gain.
      if (isWebp && buffer.length <= thresholdBytes) {
        skipped += 1;
        continue;
      }

      if (args.dryRun) {
        console.log(`[optimize-ads] Would optimize ${label} — current ${kb(buffer.length)}`);
        optimized += 1;
        continue;
      }

      const compressed = await compressImage(buffer);

      // Don't replace if compression somehow produced a larger file.
      if (compressed.length >= buffer.length) {
        console.log(`[optimize-ads] Skip ${label} — compressed ${kb(compressed.length)} >= original ${kb(buffer.length)}`);
        skipped += 1;
        continue;
      }

      const newUrl = await uploadBuffer(config, compressed, ad.imageUrl);
      await updateAdImage(config, ad, newUrl);

      console.log(`[optimize-ads] Optimized ${label}: ${kb(buffer.length)} -> ${kb(compressed.length)}`);
      optimized += 1;
    } catch (error) {
      console.error(`[optimize-ads] Failed ${label}: ${error.message}`);
      failed += 1;
    }
  }

  console.log(`[optimize-ads] Done. ${optimized} optimized, ${skipped} skipped, ${failed} failed.`);
}

main().catch((error) => {
  console.error(`[optimize-ads] Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
