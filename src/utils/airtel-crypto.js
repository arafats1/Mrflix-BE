'use strict';

const crypto = require('crypto');

function formatPublicKeyPem(base64Key) {
  const cleaned = String(base64Key || '').replace(/\s+/g, '');
  const lines = cleaned.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function createPublicKeyFromApiMaterial(keyMaterial) {
  const cleaned = String(keyMaterial || '').replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('Missing Airtel RSA public key material.');
  }

  const der = Buffer.from(cleaned, 'base64');

  try {
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return crypto.createPublicKey(formatPublicKeyPem(cleaned));
  }
}

function isPreEncryptedPin(value) {
  const candidate = String(value || '').trim();
  return candidate.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(candidate);
}

function normalizeDisbursementPin(pin) {
  return String(pin || '').trim().replace(/\D/g, '').slice(0, 4);
}

function encryptPin(keyMaterial, pin) {
  const pinStr = normalizeDisbursementPin(pin);
  if (!/^\d{4}$/.test(pinStr)) {
    throw new Error('Disbursement PIN must be exactly 4 digits.');
  }

  const publicKey = createPublicKeyFromApiMaterial(keyMaterial);
  const ciphertext = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(pinStr, 'utf8')
  );

  return ciphertext.toString('base64');
}

function resolveEncryptedPin(keyMaterial, pin, encryptedPinOverride) {
  const override = String(encryptedPinOverride || '').trim();
  if (override) return override;
  if (isPreEncryptedPin(pin)) return String(pin).trim();
  return encryptPin(keyMaterial, pin);
}

function signJsonPayload(keyMaterial, payload) {
  const publicKey = typeof keyMaterial === 'string' && keyMaterial.includes('BEGIN PUBLIC KEY')
    ? crypto.createPublicKey(keyMaterial)
    : createPublicKeyFromApiMaterial(keyMaterial);

  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const payloadString = JSON.stringify(payload);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  let xSignature = cipher.update(payloadString, 'utf8', 'base64');
  xSignature += cipher.final('base64');

  const keyIv = `${aesKey.toString('base64')}:${iv.toString('base64')}`;
  const xKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(keyIv, 'utf8')
  ).toString('base64');

  return {
    body: payloadString,
    xSignature,
    xKey,
  };
}

function hmacSha256Base64(secret, message) {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('base64');
}

function hashesMatch(expected, received) {
  const expectedBuf = Buffer.from(String(expected || ''));
  const receivedBuf = Buffer.from(String(received || ''));
  if (expectedBuf.length !== receivedBuf.length || expectedBuf.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Verify Airtel "Callback With Authentication" body hash.
 * HMAC-SHA256(compact JSON of transaction) with client secret, base64-encoded.
 * Tries parse-order stringify plus the documented field order as fallbacks.
 */
function verifyCallbackHash(payload, secret) {
  const received = String(payload?.hash || '').trim();
  const key = String(secret || '').trim();
  const transaction = payload?.transaction;

  if (!received || !key || !transaction || typeof transaction !== 'object') {
    return false;
  }

  const candidates = [
    JSON.stringify(transaction),
    JSON.stringify({
      id: transaction.id,
      message: transaction.message,
      status_code: transaction.status_code,
      airtel_money_id: transaction.airtel_money_id,
    }),
  ];

  return candidates.some((message) => hashesMatch(hmacSha256Base64(key, message), received));
}

module.exports = {
  formatPublicKeyPem,
  signJsonPayload,
  encryptPin,
  resolveEncryptedPin,
  isPreEncryptedPin,
  normalizeDisbursementPin,
  verifyCallbackHash,
};
