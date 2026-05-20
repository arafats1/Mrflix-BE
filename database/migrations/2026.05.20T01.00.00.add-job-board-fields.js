'use strict';

async function up(knex) {
  const hasTable = await knex.schema.hasTable('entrep_jobs');
  if (!hasTable) return;

  const columns = await knex('entrep_jobs').columnInfo();

  await knex.schema.alterTable('entrep_jobs', (table) => {
    if (!columns.company_logo) table.string('company_logo', 1024).nullable();
    if (!columns.job_function) table.string('job_function', 255).nullable();
    if (!columns.industry) table.string('industry', 255).nullable();
    if (!columns.experience_level) table.string('experience_level', 255).nullable();
  });
}

module.exports = { up };