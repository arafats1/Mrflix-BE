'use strict';

async function up(knex) {
  const hasTable = await knex.schema.hasTable('entrep_live_sessions');
  if (!hasTable) return;

  await knex.schema.alterTable('entrep_live_sessions', (table) => {
    table.text('host_room_url', 'longtext').alter();
    table.text('viewer_room_url', 'text').alter();
    table.text('recording_url', 'text').alter();
    table.text('transcript_url', 'text').alter();
  });
}

module.exports = { up };