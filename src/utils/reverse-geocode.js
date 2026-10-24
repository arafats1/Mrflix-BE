'use strict';

const LOCALITY_KEYS = ['suburb', 'neighbourhood', 'quarter', 'village', 'hamlet', 'city_district', 'town', 'city'];
const AREA_KEYS = ['city', 'town', 'municipality', 'county', 'state_district', 'state'];

function firstAddressValue(address, keys) {
  for (const key of keys) {
    const value = String(address?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function placeNameFromNominatim(payload) {
  const address = payload?.address || {};
  const locality = firstAddressValue(address, LOCALITY_KEYS);
  const area = firstAddressValue(address, AREA_KEYS);
  const parts = [];
  if (locality) parts.push(locality);
  if (area && area.toLowerCase() !== locality.toLowerCase()) parts.push(area);
  if (parts.length) return parts.join(', ');

  return String(payload?.display_name || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
}

async function reverseGeocodePlaceName(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=16&addressdetails=1`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MovoBrandsMarketplace/1.0 (seller shop location)',
      Accept: 'application/json',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return '';

  const payload = await response.json();
  return placeNameFromNominatim(payload).slice(0, 180);
}

module.exports = { reverseGeocodePlaceName };
