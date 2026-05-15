'use strict';

const strapiFactory = require('@strapi/strapi');
const whereby = require('../src/utils/whereby');

function isMockSession(session) {
  return String(session?.wherebyMeetingId || '').startsWith('mock_')
    || String(session?.viewerRoomUrl || '').includes('movo-entrepreneur.whereby.com')
    || String(session?.hostRoomUrl || '').includes('movo-entrepreneur.whereby.com');
}

async function main() {
  const app = await strapiFactory.createStrapi().load();

  try {
    const sessions = await app.entityService.findMany('api::entrep-live-session.entrep-live-session', {
      sort: { startsAt: 'asc' },
    });

    const mockSessions = sessions.filter(isMockSession);
    console.log(`Found ${mockSessions.length} mock live session(s) to upgrade.`);

    for (const session of mockSessions) {
      const startsAtDate = new Date(session.startsAt);
      const resolvedStartsAt = Number.isNaN(startsAtDate.getTime()) || startsAtDate.getTime() < Date.now()
        ? new Date(Date.now() + 5 * 60_000).toISOString()
        : session.startsAt;
      const resolvedEndsAt = session.endsAt || new Date(new Date(resolvedStartsAt).getTime() + (Number(session.durationMinutes) || 60) * 60_000).toISOString();

      const meeting = await whereby.createMeeting({
        startsAt: resolvedStartsAt,
        endsAt: resolvedEndsAt,
      });

      await app.entityService.update('api::entrep-live-session.entrep-live-session', session.id, {
        data: {
          startsAt: resolvedStartsAt,
          endsAt: resolvedEndsAt,
          provider: 'whereby',
          hostRoomUrl: meeting.hostRoomUrl,
          viewerRoomUrl: meeting.viewerRoomUrl,
          wherebyMeetingId: meeting.meetingId,
        },
      });

      console.log(`Updated session ${session.id} -> meeting ${meeting.meetingId}`);
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('Failed to backfill live session rooms.', error);
  process.exit(1);
});