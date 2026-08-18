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

function calculateHirePurchaseOffer(priceUGX, depositPercent) {
  const price = Math.max(0, Number(priceUGX) || 0);
  const deposit = Math.min(
    100,
    Math.max(0, Number(depositPercent) > 0 ? Number(depositPercent) : HIRE_PURCHASE_DEFAULT_DEPOSIT),
  );
  const hirePurchasePrice = Math.round(price * (1 + HIRE_PURCHASE_MARKUP));
  const depositAmount = Math.round(hirePurchasePrice * (deposit / 100));
  const loanAmount = Math.max(0, hirePurchasePrice - depositAmount);
  const monthly = loanAmount > 0 ? Math.round(loanAmount / HIRE_PURCHASE_TERM_MONTHS) : null;
  return {
    priceUGX: price,
    depositPercent: deposit,
    hirePurchasePriceUGX: hirePurchasePrice,
    depositUGX: depositAmount,
    loanAmountUGX: loanAmount,
    monthlyUGX: monthly,
    termMonths: HIRE_PURCHASE_TERM_MONTHS,
    markupPercent: HIRE_PURCHASE_MARKUP * 100,
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function simulateBureauCheck({ nin, bankId, carPriceUGX, depositPercent }) {
  const normalized = String(nin || '').replace(/[\s-]/g, '').toUpperCase();
  const seed = hashString(`${bankId || 'dfcu'}:${normalized}`);
  const creditScore = 300 + (seed % 551);
  const offer = calculateHirePurchaseOffer(carPriceUGX, depositPercent);
  let ltv = 0.2;
  let scoreBand = 'Poor';
  if (creditScore >= 750) {
    ltv = 1;
    scoreBand = 'Excellent';
  } else if (creditScore >= 700) {
    ltv = 0.85;
    scoreBand = 'Good';
  } else if (creditScore >= 650) {
    ltv = 0.7;
    scoreBand = 'Fair';
  } else if (creditScore >= 580) {
    ltv = 0.5;
    scoreBand = 'Needs work';
  }
  const maxBankLoanUGX = Math.round(offer.hirePurchasePriceUGX * ltv);
  const offerLoanAmountUGX = Math.min(offer.loanAmountUGX, maxBankLoanUGX);
  const offerDepositUGX = Math.max(0, offer.hirePurchasePriceUGX - offerLoanAmountUGX);
  const offerMonthlyUGX = offerLoanAmountUGX > 0
    ? Math.round(offerLoanAmountUGX / HIRE_PURCHASE_TERM_MONTHS)
    : null;
  return {
    simulated: true,
    nin: normalized,
    bankId: bankId || 'dfcu',
    creditScore,
    scoreBand,
    maxBankLoanUGX,
    offerLoanAmountUGX,
    offerDepositUGX,
    offerMonthlyUGX,
    offerTermMonths: HIRE_PURCHASE_TERM_MONTHS,
    offerHirePurchasePriceUGX: offer.hirePurchasePriceUGX,
    depositPercent: offer.depositPercent,
  };
}

async function findByIdOrDocumentId(strapi, uid, id, options = {}) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const byDocumentId = await strapi.db.query(uid).findOne({ where: { documentId: raw }, ...options });
  if (byDocumentId) return byDocumentId;
  if (/^\d+$/.test(raw)) {
    return strapi.db.query(uid).findOne({ where: { id: Number(raw) }, ...options });
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
  calculateHirePurchaseOffer,
  simulateBureauCheck,
};
