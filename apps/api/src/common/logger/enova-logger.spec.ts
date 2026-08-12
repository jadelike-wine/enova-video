import { describe, it, expect } from 'vitest';
import { EnovaLogger } from './enova-logger.js';

/**
 * Pino 默认使用 SonicBoom 直接写 fd 1，绕过 process.stdout.write。
 * 但 pino 在构造时会检查 hasBeenTampered(process.stdout)：
 * 若 stdout.write 已被替换，pino 退化为直接调用 process.stdout.write。
 * 因此必须在 new EnovaLogger() 之前替换 process.stdout.write，才能捕获输出。
 */
function captureStdout<T>(fn: (write: (chunk: unknown) => void) => T): { captured: string; result: T } {
  let captured = '';
  const originalStdout = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = fn((chunk: unknown) => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
    });
    return { captured, result };
  } finally {
    process.stdout.write = originalStdout;
  }
}

describe('EnovaLogger redaction', () => {
  it('redacts x-step-up-password in nested headers', () => {
    const { captured } = captureStdout(() => {
      // EnovaLogger 必须在 stdout 已被替换之后构造，
      // 否则 pino 会创建 SonicBoom 绕过 process.stdout.write。
      const logger = new EnovaLogger();
      logger.info('test', {
        headers: {
          'x-step-up-password': 'mySecretPassword123',
          'content-type': 'application/json',
        },
      });
    });

    expect(captured).toContain('[REDACTED]');
    expect(captured).not.toContain('mySecretPassword123');
  });

  it('redacts stepUpPassword at top level', () => {
    const { captured } = captureStdout(() => {
      const logger = new EnovaLogger();
      logger.info('test', {
        stepUpPassword: 'mySecretPassword123',
      });
    });

    expect(captured).toContain('[REDACTED]');
    expect(captured).not.toContain('mySecretPassword123');
  });

  it('redacts password and cookie fields', () => {
    const { captured } = captureStdout(() => {
      const logger = new EnovaLogger();
      logger.info('test', {
        password: 'secret123',
        cookie: 'session=abc',
        authorization: 'Bearer xyz',
      });
    });

    expect(captured).not.toContain('secret123');
    expect(captured).not.toContain('session=abc');
    expect(captured).not.toContain('Bearer xyz');
    expect(captured.match(/\[REDACTED\]/g)!.length).toBe(3);
  });
});
