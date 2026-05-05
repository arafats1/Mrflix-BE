'use strict';

async function recordProviderMaterialSale(strapi, purchase) {
  const providerMaterialId = purchase?.providerMaterial?.id || purchase?.providerMaterial;
  if (!providerMaterialId) return;

  const material = await strapi.db.query('api::provider-material.provider-material').findOne({
    where: { id: providerMaterialId },
    select: ['id', 'totalSales', 'totalRevenueUGX'],
  });

  if (!material) return;

  await strapi.db.query('api::provider-material.provider-material').update({
    where: { id: material.id },
    data: {
      totalSales: Number(material.totalSales || 0) + 1,
      totalRevenueUGX: Number(material.totalRevenueUGX || 0) + Number(purchase.amount || 0),
    },
  });
}

module.exports = {
  recordProviderMaterialSale,
};