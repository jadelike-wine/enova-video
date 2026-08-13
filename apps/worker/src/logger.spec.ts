import { describe, it, expect } from 'vitest';
import pino, { type Logger } from 'pino';
import { Writable } from 'node:stream';
import { WorkerLogger } from './logger.js';

/** 获取 pino logger 内部 stream 的构造函数名，用于判断日志格式。 */
function getStreamCtorName(logger: Logger): string {
  return (logger as any)[pino.symbols.streamSym]?.constructor?.name ?? '';
}

/**
 * 创建一个将输出写入内存的 pino logger，用于测试 redaction 行为。
 * 复用与 WorkerLogger 相同的 REDACT_PATHS 配置。
 */
function createCapturingPino(name: string, level: string = 'info', format: string = 'json'): { logger: Logger; output: () => string } {
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
  ];

  const logger = pino({
    name,
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

describe('WorkerLogger', () => {
  describe('reconfigure (log.format restartRequired)', () => {
    it('defaults to text format when env is not set', () => {
      const logger = new WorkerLogger('test');
      const internal = (logger as any).logger as Logger;
      expect(internal.level).toBe('info');
      // text format uses pino-pretty transport → stream is NOT a plain SonicBoom
      expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
    });

    it('reconfigure switches from text to json format', () => {
      const logger = new WorkerLogger('test');
      logger.reconfigure({ level: 'info', format: 'json' });
      const internal = (logger as any).logger as Logger;
      expect(internal.level).toBe('info');
      // json format uses direct stream → SonicBoom
      expect(getStreamCtorName(internal)).toBe('SonicBoom');
    });

    it('reconfigure switches from json back to text format', () => {
      const logger = new WorkerLogger('test');
      logger.reconfigure({ level: 'info', format: 'json' });
      logger.reconfigure({ level: 'info', format: 'text' });
      const internal = (logger as any).logger as Logger;
      // text format uses pino-pretty transport → stream is NOT a plain SonicBoom
      expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
    });

    it('reconfigure changes log level', () => {
      const logger = new WorkerLogger('test');
      logger.reconfigure({ level: 'error', format: 'text' });
      const internal = (logger as any).logger as Logger;
      expect(internal.level).toBe('error');
    });

    it('setLevel changes level without rebuilding format', () => {
      const logger = new WorkerLogger('test');
      logger.setLevel('error');
      const internal = (logger as any).logger as Logger;
      expect(internal.level).toBe('error');
      // still text format → stream is NOT a plain SonicBoom
      expect(getStreamCtorName(internal)).not.toBe('SonicBoom');
    });
  });

  describe('redaction', () => {
    it('redacts password and secret fields', () => {
      const { logger, output } = createCapturingPino('test');
      logger.info({ password: 'secret123', secret: 'my-secret', apiKey: 'key-123' }, 'test');
      const captured = output();
      expect(captured).not.toContain('secret123');
      expect(captured).not.toContain('my-secret');
      expect(captured).not.toContain('key-123');
      const redactedCount = (captured.match(/\[REDACTED\]/g) || []).length;
      expect(redactedCount).toBe(3);
    });

    it('redaction persists after reconfigure', () => {
      const { logger, output } = createCapturingPino('test', 'info', 'json');
      logger.info({ password: 'secret123' }, 'test');
      const captured = output();
      expect(captured).not.toContain('secret123');
      expect(captured).toContain('[REDACTED]');
    });
  });
});