'use strict';

const strapi = require('@strapi/strapi');

function buildEventPayload(mentorship) {
  const startsAt = mentorship.scheduledAt;
  return {
    title: `Mentorship: ${mentorship.topic || 'Session'}`,
    description: `Mentorship session with ${mentorship.mentor?.fullName || 'Expert'}`,
    eventType: 'other',
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
    visibility: 'private',
    mentorProfile: mentorship.mentor?.id || null,
    learner: mentorship.mentee?.id || null,
    mentorship: mentorship.id,
    color: '#dc2626',
  };
}

async function backfill(app) {
  const mentorships = await app.entityService.findMany('api::entrep-mentorship.entrep-mentorship', {
    filters: {
      status: 'accepted',
      scheduledAt: { $notNull: true },
    },
    populate: {
      mentor: true,
      mentee: true,
    },
  });

  console.log(`Found ${mentorships.length} accepted mentorship(s) to inspect.`);

  let created = 0;
  let updated = 0;

  for (const mentorship of mentorships) {
    const payload = buildEventPayload(mentorship);

    const existingLinked = await app.entityService.findMany('api::entrep-event.entrep-event', {
      filters: { mentorship: { id: mentorship.id } },
      limit: 1,
    });

    if (existingLinked?.[0]) {
      await app.entityService.update('api::entrep-event.entrep-event', existingLinked[0].id, {
        data: payload,
      });
      updated += 1;
      console.log(`Updated linked event ${existingLinked[0].id} for mentorship ${mentorship.id}.`);
      continue;
    }

    const legacyMatch = await app.entityService.findMany('api::entrep-event.entrep-event', {
      filters: {
        title: payload.title,
        startsAt: payload.startsAt,
        visibility: 'private',
      },
      limit: 1,
    });

    if (legacyMatch?.[0]) {
      await app.entityService.update('api::entrep-event.entrep-event', legacyMatch[0].id, {
        data: payload,
      });
      updated += 1;
      console.log(`Updated legacy event ${legacyMatch[0].id} for mentorship ${mentorship.id}.`);
      continue;
    }

    const createdEvent = await app.entityService.create('api::entrep-event.entrep-event', {
      data: payload,
    });
    created += 1;
    console.log(`Created event ${createdEvent.id} for mentorship ${mentorship.id}.`);
  }

  console.log(`Backfill complete. Created: ${created}, Updated: ${updated}.`);
}

async function main() {
  const app = await strapi.createStrapi().load();
  try {
    await backfill(app);
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to backfill mentorship calendar events.', error);
  process.exit(1);
});