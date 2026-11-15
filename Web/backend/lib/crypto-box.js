'use strict';

const crypto = require('crypto');

// Format of the stored blob: base64(iv[12] | authTag[16] | ciphertext)
const IV_LEN = 12;
const TAG_LEN = 16;

function getSecret() {
  const raw = process.env.SOURCE_KEY_SECRET;
  if (!raw) throw new Error('SOURCE_KEY_SECRET is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SOURCE_KEY_SECRET must be 32 bytes, base64 encoded');
  return key;
}

function encryptKey(plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecret(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptKey(blob) {
  const buf = Buffer.from(String(blob), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Invalid encrypted key');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function last4(plain) {
  const s = String(plain);
  return s.length <= 4 ? s : s.slice(-4);
}

module.exports = { encryptKey, decryptKey, last4 };
