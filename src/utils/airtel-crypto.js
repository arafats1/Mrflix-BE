'use strict';

const crypto = require('crypto');

function formatPublicKeyPem(base64Key) {
  const cleaned = String(base64Key || '').replace(/\s+/g, '');
  const lines = cleaned.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function signJsonPayload(publicKeyPem, payload) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const payloadString = JSON.stringify(payload);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  let xSignature = cipher.update(payloadString, 'utf8', 'base64');
  xSignature += cipher.final('base64');

  const keyIv = `${aesKey.toString('base64')}:${iv.toString('base64')}`;
  const xKey = crypto.publicEncrypt(
    {
      key: publicKeyPem,
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

function encryptPin(publicKeyPem, pin) {
  const ciphertext = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(String(pin), 'utf8')
  );

  return ciphertext.toString('base64');
}

module.exports = {
  formatPublicKeyPem,
  signJsonPayload,
  encryptPin,
};
