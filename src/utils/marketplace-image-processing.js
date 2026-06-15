'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

// Lightweight variants served in marketplace grids / lists.
const VARIANT_SPECS = {
  card: { folder: 'product-images/card', maxDimension: 960, quality: 78 },
  thumbnail: { folder: 'product-images/thumbnail', maxDimension: 320, quality: 72 },
};

// Re-encode the "original" so detail pages never serve heavy images. We aim
// for <= TARGET_ORIGINAL_BYTES by progressively lowering quality / dimensions.
const TARGET_ORIGINAL_BYTES = 500 * 1024; // 500KB
const OPTIMIZED_ORIGINAL_SPEC = { folder: 'product-images/optimized', maxDimension: 1600, quality: 82 };
// Quality / max-dimension steps tried (in order) until the encoded original
// fits under the target size. The last step is the smallest acceptable result.
const ORIGINAL_COMPRESSION_STEPS = [
  { maxDimension: 1600, quality: 82 },
  { maxDimension: 1600, quality: 72 },
  { maxDimension: 1400, quality: 68 },
  { maxDimension: 1200, quality: 62 },
  { maxDimension: 1024, quality: 58 },
  { maxDimension: 900, quality: 52 },
  { maxDimension: 800, quality: 48 },
  { maxDimension: 720, quality: 44 },
  { maxDimension: 640, quality: 40 },
];

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
    const original = entry.trim();
    return original ? { original, card: null, thumbnail: null } : null;
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
  return !!(
    entry
    && entry.original
    && entry.card
    && entry.thumbnail
    && entry.card !== entry.original
  );
}

function isOptimizedOriginalUrl(url) {
  return /\/product-images\/optimized\//i.test(String(url || ''));
}

function entryNeedsProcessing(entry, force) {
  if (!entry?.original) return false;
  if (force) return true;
  if (!hasFullVariantSet(entry)) return true;
  // Client uploads land in product-images/original — still need server-side re-encode.
  return !isOptimizedOriginalUrl(entry.original);
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

/**
 * Encode an image so it fits under `targetBytes`, stepping down quality and
 * dimensions until the target is met. Always returns the smallest variant we
 * produced even if the target could not be reached.
 */
async function compressToTarget(buffer, targetBytes) {
  let best = null;

  for (const step of ORIGINAL_COMPRESSION_STEPS) {
    let encoded;
    try {
      encoded = await renderVariant(buffer, step);
    } catch {
      continue;
    }

    if (!best || encoded.length < best.length) {
      best = encoded;
    }

    if (encoded.length <= targetBytes) {
      return encoded;
    }
  }

  return best;
}

async function uploadBuffer(storage, buffer, key) {
  await storage.s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${storage.publicUrl.replace(/\/$/, '')}/${key}`;
}

function getBaseUrl(strapi) {
  return strapi.config.get('server.absoluteUrl')
    || `http://localhost:${strapi.config.get('server.port') || 1337}`;
}

/**
 * Ensure every image on a product has lightweight card/thumbnail webp variants
 * and that heavy originals (> 500KB) are re-encoded. Safe to call repeatedly:
 * it only does work when variants are missing, the original was not yet optimized
 * on the server, or when `force` is set.
 *
 * @returns {Promise<boolean>} true when the product images were updated.
 */
async function processProductImages(strapi, identifier = {}, options = {}) {
  const force = !!options.force;

  const where = identifier.documentId
    ? { documentId: identifier.documentId }
    : identifier.id
      ? { id: identifier.id }
      : null;

  if (!where) return false;

  const product = await strapi.db.query('api::product.product').findOne({
    where,
    select: ['id', 'documentId', 'images', 'featuredImage'],
  });

  if (!product) return false;

  const entries = Array.isArray(product.images)
    ? product.images.map(normalizeImageEntry).filter(Boolean)
    : [];

  if (entries.length === 0 && product.featuredImage) {
    const featuredEntry = normalizeImageEntry(product.featuredImage);
    if (featuredEntry) entries.push(featuredEntry);
  }

  if (entries.length === 0) return false;

  const needsWork = force || entries.some((entry) => entryNeedsProcessing(entry, force));
  if (!needsWork) return false;

  const storage = getStorage();
  if (!storage.publicUrl) {
    strapi.log.warn('[marketplace-images] Skipping variant generation: storage public URL is not configured.');
    return false;
  }

  const baseUrl = getBaseUrl(strapi);
  const identityKey = product.documentId || product.id;
  const nextVariants = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const next = {
      original: entry.original,
      card: entry.card || null,
      thumbnail: entry.thumbnail || null,
    };

    const missing = Object.keys(VARIANT_SPECS).filter((name) => force || !next[name]);
    const shouldOptimizeOriginal = entryNeedsProcessing(entry, force);
    const sourceUrl = makeAbsoluteUrl(entry.original, baseUrl);

    if ((!missing.length && !shouldOptimizeOriginal) || !sourceUrl) {
      next.card = next.card || next.original;
      next.thumbnail = next.thumbnail || next.card || next.original;
      nextVariants.push(next);
      continue;
    }

    let sourceBuffer;
    try {
      sourceBuffer = await fetchBuffer(sourceUrl);
    } catch (error) {
      strapi.log.warn(`[marketplace-images] Could not download image ${index + 1} for product ${identityKey}: ${error.message}`);
      next.card = next.card || next.original;
      next.thumbnail = next.thumbnail || next.card || next.original;
      nextVariants.push(next);
      continue;
    }

    // Re-encode the original when it is heavier than the target so detail
    // pages and grids never serve oversized images.
    if (sourceBuffer.length > TARGET_ORIGINAL_BYTES) {
      try {
        const optimized = await compressToTarget(sourceBuffer, TARGET_ORIGINAL_BYTES);
        if (optimized && optimized.length < sourceBuffer.length) {
          const key = `${OPTIMIZED_ORIGINAL_SPEC.folder}/${identityKey}/${index + 1}.webp`;
          next.original = await uploadBuffer(storage, optimized, key);
          sourceBuffer = optimized;
        }
      } catch (error) {
        strapi.log.warn(`[marketplace-images] Failed to optimize original ${index + 1} for product ${identityKey}: ${error.message}`);
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

  await strapi.db.query('api::product.product').update({
    where: { id: product.id },
    data: {
      images: nextVariants,
      featuredImage: featuredVariant?.original || product.featuredImage || null,
    },
  });

  return true;
}

/**
 * Fire-and-forget wrapper so product create/update responses stay fast while
 * variant generation happens in the background.
 */
function scheduleProductImageProcessing(strapi, identifier = {}, options = {}) {
  setImmediate(async () => {
    try {
      const updated = await processProductImages(strapi, identifier, options);
      if (updated) {
        strapi.log.info(`[marketplace-images] Generated lightweight variants for product ${identifier.documentId || identifier.id}.`);
      }
    } catch (error) {
      strapi.log.error(`[marketplace-images] Background variant generation failed for product ${identifier.documentId || identifier.id}: ${error.message}`);
    }
  });
}

module.exports = {
  processProductImages,
  scheduleProductImageProcessing,
  normalizeImageEntry,
  hasFullVariantSet,
  isOptimizedOriginalUrl,
  entryNeedsProcessing,
  compressToTarget,
  renderVariant,
  uploadBuffer,
  getStorage,
  fetchBuffer,
  makeAbsoluteUrl,
  inferFeaturedIndex,
  TARGET_ORIGINAL_BYTES,
  VARIANT_SPECS,
  OPTIMIZED_ORIGINAL_SPEC,
};
