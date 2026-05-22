'use strict';

async function up(knex) {
  const hasTable = await knex.schema.hasTable('products');
  if (!hasTable) return;

  const columns = await knex('products').columnInfo();

  await knex.schema.alterTable('products', (table) => {
    if (!columns.product_video_url) table.string('product_video_url', 2048).nullable();
    if (!columns.product_video_thumbnail_url) table.string('product_video_thumbnail_url', 2048).nullable();
    if (!columns.product_video_likes) table.integer('product_video_likes').notNullable().defaultTo(0);
    if (!columns.product_video_comments) table.json('product_video_comments').nullable();
  });
}

module.exports = { up };
