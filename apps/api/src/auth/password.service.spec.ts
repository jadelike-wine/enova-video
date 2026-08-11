import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a correct password', async () => {
    const hash = await service.hash('S3cure-Passw0rd!');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(service.verify('S3cure-Passw0rd!', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('correct-horse');
    await expect(service.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('does not leak the plaintext in the stored hash', async () => {
    const plain = 'UltraSecret42';
    const hash = await service.hash(plain);
    expect(hash).not.toContain(plain);
  });

  it('returns false for malformed stored hash', async () => {
    await expect(service.verify('x', 'not-a-scrypt')).resolves.toBe(false);
    await expect(service.verify('x', 'scrypt$1$2$3$!!')).resolves.toBe(false);
  });

  it('produces distinct salts for the same password', async () => {
    const h1 = await service.hash('same-input');
    const h2 = await service.hash('same-input');
    expect(h1).not.toBe(h2);
  });
});