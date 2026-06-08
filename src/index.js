const ADMIN_ACADEMY_ACTIONS = [
  'api::entrep-course.entrep-course.find',
  'api::entrep-course.entrep-course.findOne',
  'api::entrep-course.entrep-course.adminOverview',
  'api::entrep-course.entrep-course.approveCourse',
  'api::entrep-job.entrep-job.deleteJob',
  'api::entrep-live-session.entrep-live-session.upcoming',
  'api::entrep-post.entrep-post.deletePost',
];

// Actions that any authenticated (logged-in) user must be able to call.
// These are granted to the "authenticated" role on every startup so that
// production role-permission tables always stay in sync with the code.
const AUTHENTICATED_ACTIONS = [
  'api::ai-chat.ai-chat.generateMarketplaceDescription',
  'api::ai-chat.ai-chat.generateMarketplaceAdCreatives',
  'api::ai-chat.ai-chat.getMarketplaceAdCreativesJob',
  'api::product.product.commentVideo',
  'api::push-subscription.push-subscription.upsert',
  'api::push-subscription.push-subscription.remove',
  // Homes — all authenticated routes
  'api::home-listing.home-listing.myListings',
  'api::home-listing.home-listing.homesAccount',
  'api::home-listing.home-listing.activateHomesAccount',
  'api::home-listing.home-listing.createListing',
  'api::home-listing.home-listing.updateListing',
  'api::home-listing.home-listing.setListingStatus',
  'api::home-listing.home-listing.deleteListing',
  'api::home-listing.home-listing.submitKyc',
  'api::home-listing.home-listing.myKyc',
  'api::home-listing.home-listing.reviewKyc',
  'api::home-listing.home-listing.adminOverview',
  'api::home-listing.home-listing.unlockContact',
  'api::home-listing.home-listing.createBooking',
  'api::home-listing.home-listing.reportListing',
  'api::home-listing.home-listing.myReports',
  'api::home-listing.home-listing.myBookings',
  'api::home-listing.home-listing.toggleSave',
  'api::home-listing.home-listing.mySaves',
  'api::home-listing.home-listing.setAvailability',
  'api::home-listing.home-listing.createReview',
  'api::home-listing.home-listing.checkPaymentStatus',
  // Foundation — authenticated routes
  'api::foundation-hub.foundation-hub.foundationAccount',
  'api::foundation-hub.foundation-hub.activateFoundationAccount',
  'api::foundation-hub.foundation-hub.myProfile',
  'api::foundation-hub.foundation-hub.updateProfile',
  'api::foundation-hub.foundation-hub.myItems',
  'api::foundation-hub.foundation-hub.createItems',
  'api::foundation-hub.foundation-hub.applyForItem',
  'api::foundation-hub.foundation-hub.myApplications',
  'api::foundation-hub.foundation-hub.myRequests',
  'api::foundation-hub.foundation-hub.donationHistory',
  'api::foundation-hub.foundation-hub.reviewApplication',
  'api::foundation-hub.foundation-hub.markReceived',
  'api::foundation-hub.foundation-hub.myFundraisers',
  'api::foundation-hub.foundation-hub.createFundraiser',
  'api::foundation-hub.foundation-hub.pledgeFundraiser',
  'api::foundation-hub.foundation-hub.commentFundraiser',
];

async function ensureRolePermissions(strapi, roleType, actions) {
  const knex = strapi.db.connection;
  const role = await knex('up_roles').where({ type: roleType }).first();
  if (!role) return;

  for (const action of actions) {
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
      .where({ permission_id: permission.id, role_id: role.id })
      .first();

    if (!link) {
      await knex('up_permissions_role_lnk').insert({
        permission_id: permission.id,
        role_id: role.id,
        permission_ord: 1,
      });
    }
  }
}

module.exports = {
  async register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    await ensureRolePermissions(strapi, 'admin', ADMIN_ACADEMY_ACTIONS);
    await ensureRolePermissions(strapi, 'authenticated', AUTHENTICATED_ACTIONS);
  },
};
