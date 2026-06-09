'use strict';

/**
 * Links existing Whereby S3 recordings to live sessions in the database.
 *
 * Usage: node scripts/backfill-session-recordings.js
 */

require('dotenv').config();

async function main() {
  const { createStrapi } = require('@strapi/strapi');
  const wherebyS3 = require('../src/utils/whereby-s3');

  if (!wherebyS3.isConfigured()) {
    console.error('AWS S3 is not configured. Set AWS_* env vars first.');
    process.exit(1);
  }

  const app = await createStrapi().load();

  try {
    const sessions = await app.entityService.findMany('api::entrep-live-session.entrep-live-session', {
      sort: { id: 'desc' },
      limit: 100,
      populate: { trainer: { populate: ['user'] }, course: true, cluster: true },
    });

    let linked = 0;
    for (const session of sessions) {
      if (session.recordingS3Key || session.recordingUrl) continue;
      if (!Array.isArray(session.attendees) || session.attendees.length === 0) continue;

      const match = await wherebyS3.findRecordingForSession(session);
      if (!match?.key) {
        console.log(`Session ${session.id} (${session.title}): no S3 recording found`);
        continue;
      }

      const recordingUrl = await wherebyS3.getPresignedObjectUrl(match.key);
      await app.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
        data: {
          recordingS3Key: match.key,
          recordingUrl,
          status: session.status === 'scheduled' ? 'ended' : session.status,
        },
      });

      linked += 1;
      console.log(`Session ${session.id} (${session.title}): linked ${match.key}`);
    }

    console.log(`Done. Linked ${linked} recording(s).`);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
