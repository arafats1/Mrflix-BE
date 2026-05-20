'use strict';

async function up(knex) {
  const hasTable = await knex.schema.hasTable('up_users');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('up_users', 'avatar_url');
  if (hasColumn) return;

  await knex.schema.alterTable('up_users', (table) => {
    table.string('avatar_url', 1024).nullable().defaultTo(null);
  });
}

module.exports = { up };
