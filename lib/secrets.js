// lib/secrets.js — cifragem simétrica (AES-256-GCM) para segredos por organização guardados no banco
// (ex.: a API key da Evolution que cada org VIP traz). Chave em ENCRYPTION_KEY (.env), nunca no banco.
const crypto = require('crypto');

function key() {
  const k = process.env.ENCRYPTION_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex'); // 32 bytes em hex
  return crypto.createHash('sha256').update(k).digest();          // deriva 32 bytes de qualquer string
}

// Retorna base64(iv[12] | tag[16] | ciphertext), ou null.
function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(b64) {
  if (!b64) return null;
  const data = Buffer.from(b64, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ct = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
