'use strict';

/**
 * In-memory job store for long-running AI ad-creative generation.
 *
 * Railway's edge proxy drops any HTTP connection that stays idle for ~60s, and
 * high-quality gpt-image generation regularly runs longer than that. To avoid
 * the dropped-connection error (which surfaces in the browser as a misleading
 * CORS / "failed to fetch" error), we generate in the background and let the
 * client poll for the result instead of holding one long request open.
 *
 * Jobs are short-lived (a few minutes) and tied to the user that created them.
 * Results are kept briefly after completion so the client can pick them up,
 * then garbage-collected. This is intentionally process-local: it is simple,
 * needs no extra infrastructure, and the work always finishes inside the same
 * process that holds the map.
 */

const JOBS = new Map();
const RESULT_TTL_MS = 15 * 60 * 1000; // keep finished jobs for 15 minutes
const PENDING_TTL_MS = 20 * 60 * 1000; // safety net for stuck pending jobs

/** @param {number} userId */
function createJob(userId) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  JOBS.set(id, {
    id,
    userId,
    status: 'pending',
    result: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
  });
  return id;
}

/** @param {string} id */
function getJob(id) {
  return JOBS.get(id) || null;
}

/**
 * @param {string} id
 * @param {any} result
 */
function completeJob(id, result) {
  const job = JOBS.get(id);
  if (!job) return;
  job.status = 'completed';
  job.result = result;
  job.finishedAt = Date.now();
}

/**
 * @param {string} id
 * @param {string} message
 */
function failJob(id, message) {
  const job = JOBS.get(id);
  if (!job) return;
  job.status = 'failed';
  job.error = message;
  job.finishedAt = Date.now();
}

function cleanup() {
  const now = Date.now();
  for (const [id, job] of JOBS) {
    const age = now - (job.finishedAt || job.createdAt);
    const ttl = job.finishedAt ? RESULT_TTL_MS : PENDING_TTL_MS;
    if (age > ttl) JOBS.delete(id);
  }
}

const timer = setInterval(cleanup, 5 * 60 * 1000);
if (typeof timer.unref === 'function') timer.unref();

module.exports = { createJob, getJob, completeJob, failJob };
