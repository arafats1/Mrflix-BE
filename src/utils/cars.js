'use strict';

const CAR_CATEGORIES = [
  'Toyota', 'Subaru', 'Mercedes-Benz', 'Nissan', 'Volkswagen', 'Audi', 'BAW', 'BMW',
  'Chevrolet', 'Chrysler', 'Daihatsu', 'Datsun', 'Fiat', 'Ford', 'Foton', 'Honda',
  'Hummer', 'Hyundai', 'Infiniti', 'Isuzu', 'Jaguar', 'Jeep', 'Jetour', 'Kia',
  'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln', 'Maxus', 'Mazda', 'Mini',
  'Mitsubishi', 'Opel', 'Peugeot', 'Porsche', 'Renault', 'Rover', 'Smart', 'Suzuki',
  'Tata', 'Tesla', 'Volvo', 'Other Make', 'Automotive',
];

function isCarCategory(category) {
  return CAR_CATEGORIES.includes(String(category || '').trim());
}

function carProductFilters() {
  return { category: { $in: CAR_CATEGORIES } };
}

async function findByIdOrDocumentId(strapi, uid, id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const byDocumentId = await strapi.db.query(uid).findOne({ where: { documentId: raw } });
  if (byDocumentId) return byDocumentId;
  if (/^\d+$/.test(raw)) {
    return strapi.db.query(uid).findOne({ where: { id: Number(raw) } });
  }
  return null;
}

module.exports = {
  CAR_CATEGORIES,
  isCarCategory,
  carProductFilters,
  findByIdOrDocumentId,
};
