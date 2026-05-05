#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream/promises');

const DEFAULT_STRAPI_URL = 'https://mrflix-be-production.up.railway.app';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_POLL_INTERVAL_MS = 30000;
const DEFAULT_READY_TIMEOUT_MS = 30 * 60 * 1000;
const STATE_FILE = path.join(__dirname, '.bunny-stream-migration-state.json');

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: 0,
    movie: '',
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
    resumeOnly: false,
    includeTranslated: true,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--resume-only') options.resumeOnly = true;
    else if (arg === '--skip-translated') options.includeTranslated = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--limit=')) options.limit = Math.max(0, Number(arg.split('=')[1]) || 0);
    else if (arg.startsWith('--movie=')) options.movie = (arg.split('=')[1] || '').trim();
    else if (arg.startsWith('--poll-ms=')) options.pollIntervalMs = Math.max(1000, Number(arg.split('=')[1]) || DEFAULT_POLL_INTERVAL_MS);
    else if (arg.startsWith('--timeout-ms=')) options.readyTimeoutMs = Math.max(1000, Number(arg.split('=')[1]) || DEFAULT_READY_TIMEOUT_MS);
  }

  return options;
}

function printHelp() {
  console.log([
    'Migrate existing Strapi movie assets to Bunny Stream.',
    '',
    'Required env vars:',
    '  STRAPI_API_TOKEN          Full-access token for the production Strapi API',
    '  BUNNY_STREAM_LIBRARY_ID   Bunny Stream library id',
    '  BUNNY_STREAM_API_KEY      Bunny Stream API key',
    '  BUNNY_STREAM_CDN_HOSTNAME Bunny CDN hostname',
    '',
    'Optional env vars:',
    `  STRAPI_URL               Defaults to ${DEFAULT_STRAPI_URL}`,
    '',
    'Options:',
    '  --dry-run         Show which movie assets would be migrated',
    '  --limit=N         Process at most N asset jobs this run',
    '  --movie=ID        Only process a specific movie documentId/id',
    '  --resume-only     Only resume jobs already recorded in the state file',
    '  --skip-translated Skip translated audio/video assets',
    '  --poll-ms=N       Poll interval for Bunny encode status',
    '  --timeout-ms=N    Maximum wait per asset for Bunny encode completion',
  ].join('\n'));
}

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

async function strapiFetchJson(url, token, options = {}) {
  const headers = {
    accept: 'application/json',
    ...options.headers,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === 'string'
      ? data
      : data?.error?.message || JSON.stringify(data || {});
    throw new Error(`Strapi ${res.status}: ${detail}`);
  }
  return data;
}

async function bunnyFetchJson(url, apiKey, options = {}) {
  const headers = {
    accept: 'application/json',
    AccessKey: apiKey,
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
    throw new Error(`Bunny ${res.status}: ${detail}`);
  }
  return data;
}

async function fetchAllMovies(strapiUrl, token, movieFilter) {
  const items = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const url = new URL('/api/movies', strapiUrl);
    url.searchParams.set('pagination[page]', String(page));
    url.searchParams.set('pagination[pageSize]', String(DEFAULT_PAGE_SIZE));
    url.searchParams.set('sort[0]', 'id:asc');
    if (movieFilter) {
      url.searchParams.set('filters[$or][0][documentId][$eq]', movieFilter);
      url.searchParams.set('filters[$or][1][id][$eq]', movieFilter);
    }
    const payload = await strapiFetchJson(url, token);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    items.push(...data);
    pageCount = Number(payload?.meta?.pagination?.pageCount) || 1;
    page += 1;
  }

  return items;
}

function normalizeMovieId(movie) {
  return String(movie.documentId || movie.id || '');
}

function candidateJobsForMovie(movie, includeTranslated) {
  const jobs = [];
  const movieId = normalizeMovieId(movie);
  const title = (movie.title || `Movie ${movieId}`).trim();

  const mainSource = typeof movie.videoUrl === 'string' && movie.videoUrl.trim()
    ? movie.videoUrl.trim()
    : (typeof movie.embedUrl === 'string' ? movie.embedUrl.trim() : '');
  if (mainSource && !movie.bunnyVideoId) {
    jobs.push({
      key: `${movieId}:main`,
      movieId,
      title,
      field: 'bunnyVideoId',
      sourceField: mainSource === movie.videoUrl ? 'videoUrl' : 'embedUrl',
      sourceUrl: mainSource,
      bunnyTitle: title,
      translated: false,
    });
  }

  if (includeTranslated) {
    const translatedSource = typeof movie.lugandaVideoUrl === 'string' ? movie.lugandaVideoUrl.trim() : '';
    const languageLabel = movie.translatedLanguage || 'Translated';
    if (translatedSource && !movie.lugandaBunnyVideoId) {
      jobs.push({
        key: `${movieId}:translated`,
        movieId,
        title,
        field: 'lugandaBunnyVideoId',
        sourceField: 'lugandaVideoUrl',
        sourceUrl: translatedSource,
        bunnyTitle: `${title} (${languageLabel})`,
        translated: true,
      });
    }
  }

  return jobs;
}

async function createBunnyVideo(libraryId, apiKey, title) {
  const payload = await bunnyFetchJson(
    `https://video.bunnycdn.com/library/${libraryId}/videos`,
    apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.slice(0, 200) || 'Untitled' }),
    }
  );

  const videoId = payload?.guid;
  if (!videoId) throw new Error('Bunny create video did not return a guid');
  return videoId;
}

function requestStream(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const req = client.get(target, (res) => {
      const status = Number(res.statusCode) || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while fetching ${url}`));
          return;
        }
        resolve(requestStream(new URL(res.headers.location, target).toString(), redirectsLeft - 1));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Could not download source asset (${status})`));
        return;
      }
      resolve({ stream: res, headers: res.headers, statusCode: status });
    });
    req.on('error', reject);
  });
}

async function uploadRemoteToBunny(libraryId, apiKey, videoId, sourceUrl) {
  const source = await requestStream(sourceUrl);
  const uploadUrl = new URL(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`);

  await new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          AccessKey: apiKey,
          'Content-Type': source.headers['content-type'] || 'application/octet-stream',
          ...(source.headers['content-length'] ? { 'Content-Length': source.headers['content-length'] } : {}),
        },
      },
      async (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
            resolve();
            return;
          }
          reject(new Error(`Bunny upload failed (${res.statusCode}): ${body}`));
        });
      }
    );

    req.on('error', reject);
    pipeline(source.stream, req).catch(reject);
  });
}

async function fetchBunnyStatus(libraryId, apiKey, videoId) {
  return bunnyFetchJson(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`, apiKey);
}

async function waitForReady(libraryId, apiKey, videoId, pollIntervalMs, readyTimeoutMs) {
  const started = Date.now();
  while (Date.now() - started < readyTimeoutMs) {
    const status = await fetchBunnyStatus(libraryId, apiKey, videoId);
    const encodeState = Number(status?.status);
    if (encodeState === 4) {
      return { ready: true, status };
    }
    if (encodeState === 5 || encodeState === 6) {
      return { ready: false, status, fatal: true };
    }
    console.log(`  waiting for Bunny encode: videoId=${videoId} state=${encodeState} progress=${Number(status?.encodeProgress) || 0}%`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return { ready: false, status: null, fatal: false };
}

async function updateMovieField(strapiUrl, token, movieId, field, value) {
  if (!token) throw new Error('STRAPI_API_TOKEN is required to update movie records');
  const url = new URL(`/api/movies/${encodeURIComponent(movieId)}`, strapiUrl);
  await strapiFetchJson(url, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { [field]: value } }),
  });
}

function trimState(state, activeKeys) {
  const next = {};
  for (const key of Object.keys(state)) {
    if (activeKeys.has(key) || state[key]?.status === 'applied') {
      next[key] = state[key];
    }
  }
  return next;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const strapiUrl = (process.env.STRAPI_URL || DEFAULT_STRAPI_URL).trim();
  const strapiToken = (process.env.STRAPI_API_TOKEN || '').trim();
  if (!options.dryRun && !strapiToken) {
    throw new Error('Missing required environment variable: STRAPI_API_TOKEN');
  }
  const bunnyLibraryId = requireEnv('BUNNY_STREAM_LIBRARY_ID');
  const bunnyApiKey = requireEnv('BUNNY_STREAM_API_KEY');
  const bunnyCdnHostname = requireEnv('BUNNY_STREAM_CDN_HOSTNAME');

  const state = readState();
  const movies = await fetchAllMovies(strapiUrl, strapiToken, options.movie);
  const jobs = [];
  const jobKeys = new Set();

  for (const movie of movies) {
    const candidates = candidateJobsForMovie(movie, options.includeTranslated);
    for (const job of candidates) {
      if (options.resumeOnly && !state[job.key]?.videoId) continue;
      jobs.push(job);
      jobKeys.add(job.key);
    }
  }

  const trimmedState = trimState(state, jobKeys);
  if (JSON.stringify(trimmedState) !== JSON.stringify(state)) {
    writeState(trimmedState);
  }

  const effectiveJobs = options.limit > 0 ? jobs.slice(0, options.limit) : jobs;
  console.log(`Found ${jobs.length} candidate asset job(s); processing ${effectiveJobs.length}.`);
  console.log(`Target Strapi: ${strapiUrl}`);
  console.log(`Target Bunny CDN: ${bunnyCdnHostname}`);

  if (!effectiveJobs.length) {
    console.log('Nothing to migrate.');
    return;
  }

  if (options.dryRun) {
    for (const job of effectiveJobs) {
      console.log(`[dry-run] ${job.movieId} ${job.field} <= ${job.sourceUrl}`);
    }
    return;
  }

  let migrated = 0;
  let pending = 0;
  let failed = 0;
  const liveState = readState();

  for (const job of effectiveJobs) {
    console.log(`\nMigrating ${job.key} from ${job.sourceField}`);
    const existing = liveState[job.key] || {};
    try {
      if (!existing.videoId) {
        const videoId = await createBunnyVideo(bunnyLibraryId, bunnyApiKey, job.bunnyTitle);
        liveState[job.key] = {
          movieId: job.movieId,
          field: job.field,
          sourceField: job.sourceField,
          sourceUrl: job.sourceUrl,
          bunnyTitle: job.bunnyTitle,
          videoId,
          status: 'created',
          updatedAt: nowIso(),
        };
        writeState(liveState);
      }

      const videoId = liveState[job.key].videoId;
      if (!['uploaded', 'awaiting-encode', 'applied'].includes(liveState[job.key].status)) {
        await uploadRemoteToBunny(bunnyLibraryId, bunnyApiKey, videoId, job.sourceUrl);
        liveState[job.key] = {
          ...liveState[job.key],
          status: 'uploaded',
          lastError: '',
          updatedAt: nowIso(),
        };
        writeState(liveState);
      }

      const ready = await waitForReady(
        bunnyLibraryId,
        bunnyApiKey,
        videoId,
        options.pollIntervalMs,
        options.readyTimeoutMs
      );

      if (!ready.ready) {
        liveState[job.key] = {
          ...liveState[job.key],
          status: ready.fatal ? 'failed' : 'awaiting-encode',
          lastError: ready.fatal ? `Bunny encode failed for videoId=${videoId}` : '',
          updatedAt: nowIso(),
        };
        writeState(liveState);
        if (ready.fatal) {
          failed += 1;
          console.log(`  failed: Bunny reported an encoding error for ${videoId}`);
        } else {
          pending += 1;
          console.log(`  pending: Bunny is still encoding ${videoId}; rerun with --resume-only later.`);
        }
        continue;
      }

      await updateMovieField(strapiUrl, strapiToken, job.movieId, job.field, videoId);
      liveState[job.key] = {
        ...liveState[job.key],
        status: 'applied',
        appliedAt: nowIso(),
        playbackUrl: `https://${bunnyCdnHostname}/${videoId}/playlist.m3u8`,
        updatedAt: nowIso(),
      };
      writeState(liveState);
      migrated += 1;
      console.log(`  applied: ${job.movieId} ${job.field}=${videoId}`);
    } catch (error) {
      failed += 1;
      liveState[job.key] = {
        ...(liveState[job.key] || {}),
        movieId: job.movieId,
        field: job.field,
        sourceField: job.sourceField,
        sourceUrl: job.sourceUrl,
        bunnyTitle: job.bunnyTitle,
        status: 'failed',
        lastError: error.message,
        updatedAt: nowIso(),
      };
      writeState(liveState);
      console.error(`  error: ${error.message}`);
    }
  }

  console.log('\nMigration summary');
  console.log(`  migrated: ${migrated}`);
  console.log(`  pending:  ${pending}`);
  console.log(`  failed:   ${failed}`);
  console.log(`  state:    ${STATE_FILE}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});