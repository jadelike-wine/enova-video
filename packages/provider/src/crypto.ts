import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Provider Secret 加密：authenticated encryption (AES-256-GCM)。
 * - Master Key 从环境变量 / 未来 KMS 获取（32 字节）。
 * - 输出格式：base64(iv | authTag | ciphertext)，可整体存一列。
 * - 日志/API 绝不返回明文。
 */

const IV_LENGTH = 12; // GCM recommended
const AUTH_TAG_LENGTH = 16;
const KEY_BYTES = 32;

function masterKeyFromHexOrBase64(masterKey: string): Buffer {
  const hex = masterKey.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === KEY_BYTES * 2) {
    return Buffer.from(hex, 'hex');
  }
  const buf = Buffer.from(masterKey, 'base64');
  if (buf.length === KEY_BYTES) return buf;
  // 兜底：直接对字符串做 SHA-256 派生（仅用于测试/非生产）
  return createHash('sha256').update(masterKey).digest();
}

export class CredentialCrypto {
  constructor(private readonly masterKey: Buffer) {}

  static fromEnv(masterKey: string): CredentialCrypto {
    return new CredentialCrypto(masterKeyFromHexOrBase64(masterKey));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted credential payload');
    }
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

export const CREDENTIAL_CRYPTO = Symbol('CREDENTIAL_CRYPTO');