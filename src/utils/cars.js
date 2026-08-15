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

const HIRE_PURCHASE_TERM_MONTHS = 12;
const HIRE_PURCHASE_MARKUP = 0.1;
const HIRE_PURCHASE_DEFAULT_DEPOSIT = 50;

function calculateHirePurchaseMonthly(priceUGX, depositPercent) {
  const price = Math.max(0, Number(priceUGX) || 0);
  if (!price) return null;
  const deposit = Math.min(
    100,
    Math.max(0, Number(depositPercent) > 0 ? Number(depositPercent) : HIRE_PURCHASE_DEFAULT_DEPOSIT),
  );
  const hirePurchasePrice = price * (1 + HIRE_PURCHASE_MARKUP);
  const financed = hirePurchasePrice * (1 - deposit / 100);
  if (financed <= 0) return null;
  return Math.round(financed / HIRE_PURCHASE_TERM_MONTHS);
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
  HIRE_PURCHASE_TERM_MONTHS,
  calculateHirePurchaseMonthly,
};
