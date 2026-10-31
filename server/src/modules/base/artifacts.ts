import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export type ArtifactKey = Readonly<{ version: string; bytes: Buffer }>;
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function validateKey(key: ArtifactKey) {
  if (key.bytes.length !== 32 || !/^[a-zA-Z0-9_-]{1,64}$/.test(key.version)) throw new Error('invalid_artifact_key');
}
export function sealArtifact(plaintext: string, key: ArtifactKey, scope: string): string {
  validateKey(key);
  if (!plaintext || Buffer.byteLength(plaintext) > 128 * 1024) throw new Error('invalid_artifact_size');
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key.bytes, nonce);
  cipher.setAAD(Buffer.from(`${key.version}:${scope}`));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function openArtifact(ciphertext: string, key: ArtifactKey, scope: string): string {
  validateKey(key);
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < 29 || raw.length > 128 * 1024 + 28) throw new Error('invalid_artifact_size');
  const decipher = createDecipheriv('aes-256-gcm', key.bytes, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28)); decipher.setAAD(Buffer.from(`${key.version}:${scope}`));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
