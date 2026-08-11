import { describe, expect, it } from 'vitest';
import { CredentialCrypto } from '../crypto.js';

const MASTER_KEY = 'a'.repeat(64); // 32 bytes hex

describe('CredentialCrypto (AES-256-GCM)', () => {
  it('encrypt/decrypt roundtrip', () => {
    const crypto = CredentialCrypto.fromEnv(MASTER_KEY);
    const secret = 'sk-agnes-live-1234567890';
    const ciphertext = crypto.encrypt(secret);
    expect(ciphertext).not.toContain(secret);
    expect(crypto.decrypt(ciphertext)).toBe(secret);
  });

  it('produces unique ciphertext per call (random IV)', () => {
    const crypto = CredentialCrypto.fromEnv(MASTER_KEY);
    const a = crypto.encrypt('same-secret');
    const b = crypto.encrypt('same-secret');
    expect(a).not.toBe(b);
  });

  it('wrong master key fails to decrypt', () => {
    const good = CredentialCrypto.fromEnv(MASTER_KEY);
    const ciphertext = good.encrypt('sk-secret');
    const bad = CredentialCrypto.fromEnv('b'.repeat(64));
    expect(() => bad.decrypt(ciphertext)).toThrow();
  });

  it('tampered ciphertext fails authentication', () => {
    const crypto = CredentialCrypto.fromEnv(MASTER_KEY);
    const ciphertext = crypto.encrypt('sk-secret');
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0x01; // 翻转最后一个字节
    expect(() => crypto.decrypt(buf.toString('base64'))).toThrow();
  });

  it('never exposes plaintext in serializable output', () => {
    const crypto = CredentialCrypto.fromEnv(MASTER_KEY);
    const secret = 'sk-top-secret-42';
    const stored = crypto.encrypt(secret);
    const loggable = JSON.stringify({ encrypted: stored, status: 'ACTIVE' });
    expect(loggable).not.toContain(secret);
    expect(stored).not.toContain('sk-');
  });
});