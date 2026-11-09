'use strict';

/**
 * Strapi 5 rewrites a product's published row on every update, so two updates
 * of the same product at the same moment collide ("A published entry with
 * documentId ... already exists"). That happened when a seller's save landed
 * while the background image job was writing the same product, and the save
 * (often the Publish) was rejected. Writes to one product go through here and
 * run one after another. The app runs as a single Node process, so an
 * in-memory queue per product is enough.
 */
const queues = new Map();

async function withProductWriteLock(documentId, write) {
  if (!documentId) return write();

  const previous = queues.get(documentId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queues.set(documentId, tail);

  try {
    await previous;
    return await write();
  } finally {
    release();
    if (queues.get(documentId) === tail) queues.delete(documentId);
  }
}

module.exports = { withProductWriteLock };
