import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptRaw, timingSafeEqual } from 'node:crypto';

const N = 16384; // 2^14 内存成本
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptRaw(password, salt, keylen, opts, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * 密码哈希：使用 Node 内置 scrypt（成熟、无原生依赖）。
 * 格式：`scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`
 * 严禁记录明文密码。
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const key = await scryptAsync(plain, salt, KEY_LEN, { N, r: R, p: P });
    return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    try {
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const actual = await scryptAsync(plain, salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      });
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}