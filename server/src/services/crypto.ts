import CryptoJS from 'crypto-js';

const KEY = process.env.ENCRYPTION_KEY || 'insecure-dev-key-change-me';

/** Encrypts a credential (page access token, app secret) before it is stored in the database. */
export function encrypt(plainText: string): string {
  return CryptoJS.AES.encrypt(plainText, KEY).toString();
}

/** Decrypts a credential read back from the database. Never sent to the frontend. */
export function decrypt(cipherText: string): string {
  const bytes = CryptoJS.AES.decrypt(cipherText, KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
