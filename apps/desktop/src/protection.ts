/** Password wrapping is independent of biometrics: loss of Touch ID never loses the data. */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as derive } from 'node:crypto';

export interface WrappedKey { version: 1; salt: string; iv: string; tag: string; data: string }
async function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => derive(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function wrapKey(secret: Buffer, password: string): Promise<WrappedKey> {
  if (password.length < 12 || password.length > 1024) throw new Error('Use a password of 12–1024 characters.');
  const salt = randomBytes(32); const iv = randomBytes(12); const key = await passwordKey(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('Synapse vault key v1'));
    const data = Buffer.concat([cipher.update(secret), cipher.final()]);
    return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  } finally { key.fill(0); }
}
export async function unwrapKey(w: WrappedKey, password: string): Promise<Buffer> {
  if (w.version !== 1 || password.length > 1024) throw new Error('Unsupported protection format.');
  const salt = Buffer.from(w.salt, 'base64'); const iv = Buffer.from(w.iv, 'base64'); const tag = Buffer.from(w.tag, 'base64');
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid protection file.');
  const key = await passwordKey(password, salt);
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('Synapse vault key v1')); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(Buffer.from(w.data, 'base64')), cipher.final()]);
  } finally { key.fill(0); }
}
