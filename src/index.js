const ADMIN_ACADEMY_ACTIONS = [
  'api::entrep-course.entrep-course.find',
  'api::entrep-course.entrep-course.findOne',
  'api::entrep-course.entrep-course.approveCourse',
  'api::entrep-live-session.entrep-live-session.upcoming',
];

async function ensureAdminAcademyPermissions(strapi) {
  const knex = strapi.db.connection;
  const adminRole = await knex('up_roles').where({ type: 'admin' }).first();
  if (!adminRole) return;

  for (const action of ADMIN_ACADEMY_ACTIONS) {
    let permission = await knex('up_permissions').where({ action }).first();
    if (!permission) {
      const timestamp = new Date();
      const inserted = await knex('up_permissions').insert({
        action,
        created_at: timestamp,
        updated_at: timestamp,
        published_at: timestamp,
      });
      const permissionId = Array.isArray(inserted) ? inserted[0] : inserted;
      permission = await knex('up_permissions').where({ id: permissionId }).first();
    }

    const link = await knex('up_permissions_role_lnk')
      .where({ permission_id: permission.id, role_id: adminRole.id })
      .first();

    if (!link) {
      await knex('up_permissions_role_lnk').insert({
        permission_id: permission.id,
        role_id: adminRole.id,
        permission_ord: 1,
      });
    }
  }
}

module.exports = {
  async register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    await ensureAdminAcademyPermissions(strapi);
  },
};
