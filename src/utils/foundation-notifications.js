'use strict';

const { createNotification } = require('./entrep-notifications');

async function notifyDonorNewRequest(strapi, { application, item, beneficiary, donor }) {
  const donorId = Number(donor?.id || item?.donor?.id || item?.donor || 0);
  const actorId = Number(beneficiary?.id || 0);
  if (!donorId || !actorId || donorId === actorId) return;

  const beneficiaryName = beneficiary?.fullName || beneficiary?.username || 'A beneficiary';
  const itemName = item?.customItemName || item?.category || 'donation item';
  const qty = Number(application?.quantityRequested || 1);

  try {
    await createNotification(strapi, {
      recipientId: donorId,
      actorId,
      type: 'system',
      title: 'New donation request',
      message: `${beneficiaryName} requested ${qty} × ${itemName}. Review the request on your dashboard.`,
      actionUrl: '/foundation/dashboard?tab=requests',
      metadata: {
        category: 'foundation_request',
        applicationId: application?.id || null,
        itemId: item?.id || null,
      },
    });
  } catch (err) {
    strapi.log.warn(`Foundation request notification failed: ${err.message}`);
  }
}

module.exports = {
  notifyDonorNewRequest,
};
