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

async function notifyBeneficiaryRequestApproved(strapi, { application, item, beneficiary, donor, pickupLocation, pickupPhone }) {
  const beneficiaryId = Number(beneficiary?.id || application?.beneficiary?.id || application?.beneficiary || 0);
  const actorId = Number(donor?.id || item?.donor?.id || item?.donor || 0);
  if (!beneficiaryId || !actorId || beneficiaryId === actorId) return;

  const donorName = donor?.fullName || donor?.username || 'The donor';
  const itemName = item?.customItemName || item?.category || 'donation item';
  const qty = Number(application?.quantityApproved || application?.quantityRequested || 1);
  const location = typeof pickupLocation === 'string' ? pickupLocation.trim() : '';
  const phone = typeof pickupPhone === 'string' ? pickupPhone.trim() : '';
  const pickupHint = location && phone ? ` Pickup: ${location}. Call ${phone}.` : location ? ` Pickup: ${location}.` : '';

  try {
    await createNotification(strapi, {
      recipientId: beneficiaryId,
      actorId,
      type: 'system',
      title: 'Donation request approved',
      message: `${donorName} approved your request for ${qty} × ${itemName}.${pickupHint} Mark as received once you collect the items.`,
      actionUrl: '/foundation/dashboard?tab=applications',
      metadata: {
        category: 'foundation_request_approved',
        applicationId: application?.id || null,
        itemId: item?.id || null,
      },
    });
  } catch (err) {
    strapi.log.warn(`Foundation approval notification failed: ${err.message}`);
  }
}

async function notifyDonorItemReceived(strapi, { application, item, beneficiary, donor }) {
  const donorId = Number(donor?.id || item?.donor?.id || item?.donor || 0);
  const actorId = Number(beneficiary?.id || application?.beneficiary?.id || 0);
  if (!donorId || !actorId || donorId === actorId) return;

  const beneficiaryName = beneficiary?.fullName || beneficiary?.username || 'The beneficiary';
  const itemName = item?.customItemName || item?.category || 'donation item';
  const qty = Number(application?.quantityApproved || application?.quantityRequested || 1);

  try {
    await createNotification(strapi, {
      recipientId: donorId,
      actorId,
      type: 'system',
      title: 'Donation received',
      message: `${beneficiaryName} confirmed receipt of ${qty} × ${itemName}. View the record in your donation history.`,
      actionUrl: '/foundation/dashboard?tab=history',
      metadata: {
        category: 'foundation_item_received',
        applicationId: application?.id || null,
        itemId: item?.id || null,
      },
    });
  } catch (err) {
    strapi.log.warn(`Foundation received notification failed: ${err.message}`);
  }
}

module.exports = {
  notifyDonorNewRequest,
  notifyBeneficiaryRequestApproved,
  notifyDonorItemReceived,
};
