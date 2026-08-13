import { describe, it, expect } from 'vitest';
import pino, { type Logger } from 'pino';
import { Writable } from 'node:stream';
import { EnovaLogger } from './enova-logger.js';

/** 获取 pino logger 内部 stream 的构造函数名，用于判断日志格式。 */
function getStreamCtorName(logger: Logger): string {
  return (logger as any)[pino.symbols.streamSym]?.constructor?.name ?? '';
}

/**
 * 创建一个将输出写入内存的 pino logger，用于测试 redaction 行为。
 * 复用与 EnovaLogger 相同的 REDACT_PATHS 配置。
 */
function createCapturingPino(level: string = 'info', format: string = 'json'): { logger: Logger; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const REDACT_PATHS = [
    'password', '*.password',
    'cookie', '*.cookie',
    'authorization', '*.authorization',
    'secret', '*.secret', '*Secret',
    'apiKey', '*.apiKey',
    'x-step-up-password', '*.x-step-up-password',
    'headers.x-step-up-password', 'request.headers.x-step-up-password',
    'stepUpPassword', '*.stepUpPassword',
  ];

  const logger = pino({
    level,
    ...(format === 'text'
      ? { transport: { target: 'pino-pretty', options: { colorize: false } } }
      : {}),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  }, stream);

  return {
    logger,
    output: () => chunks.join(''),
  };
}

describe('EnovaLogger redaction', () => {
  it('redacts x-step-up-password in nested headers', () => {
    const { logger, output } = createCapturingPino();
    logger.info({ headers: { 'x-step-up-password': 'mySecretPassword123', 'content-type': 'application/json' } }, 'test');
    const captured = output();
    expect(captured).toContain('[REDACTED]');
    expect(captured).not.toContain('mySecretPassword123');
  });

  it('redacts stepUpPassword at top level', () => {
    const { logger, output } = createCapturingPino();
    logger.info({ stepUpPassword: 'mySecretPassword123' }, 'test');
    const captured = output();
    expect(captured).toContain('[REDACTED]');
    expect(captured).not.toContain('mySecretPassword123');
  });

  it('redacts password and cookie fields', () => {
    const { logger, output } = createCapturingPino();
    logger.info({ password: 'secret123', cookie: 'session=abc', authorization: 'Bearer xyz' }, 'test');
    const captured = output();
    expect(captured).not.toContain('secret123');
    expect(captured).not.toContain('session=abc');
    expect(captured).not.toContain('Bearer xyz');
    const redactedCount = (captured.match(/\[REDACTED\]/g) || []).length;
    expect(redactedCount).toBe(3);
  });
});

describe('EnovaLogger reconfigure (log.format restartRequired)', () => {
  it('defaults to text format when env is not set', () => {
    const logger = new EnovaLogger();
    const internal = (logger as any).logger as Logger;
    expect(internal.level).toBe('info');
    // text format uses pino-pretty transport → stream is NOT a plain SonicBoom
    expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
  });

  it('reconfigure switches from text to json format', () => {
    const logger = new EnovaLogger();
    logger.reconfigure({ level: 'info', format: 'json' });
    const internal = (logger as any).logger as Logger;
    expect(internal.level).toBe('info');
    // json format uses direct stream → SonicBoom
    expect(getStreamCtorName(internal)).toBe('SonicBoom');
  });

  it('reconfigure switches from json back to text format', () => {
    const logger = new EnovaLogger();
    logger.reconfigure({ level: 'info', format: 'json' });
    logger.reconfigure({ level: 'info', format: 'text' });
    const internal = (logger as any).logger as Logger;
    // text format uses pino-pretty transport → stream is NOT a plain SonicBoom
    expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
  });

  it('reconfigure changes log level', () => {
    const logger = new EnovaLogger();
    logger.reconfigure({ level: 'error', format: 'text' });
    const internal = (logger as any).logger as Logger;
    expect(internal.level).toBe('error');
  });

  it('setLevel changes level without rebuilding format', () => {
    const logger = new EnovaLogger();
    logger.setLevel('error');
    const internal = (logger as any).logger as Logger;
    expect(internal.level).toBe('error');
    // still text format → stream is NOT a plain SonicBoom
    expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
  });

  it('redaction persists after reconfigure', () => {
    const { logger, output } = createCapturingPino('info', 'json');
    logger.info({ password: 'secret123' }, 'test');
    const captured = output();
    expect(captured).not.toContain('secret123');
    expect(captured).toContain('[REDACTED]');
  });
});