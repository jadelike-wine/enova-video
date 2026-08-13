import { Injectable, LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

export interface LogFields {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  generationJobId?: string;
  provider?: string;
  providerCredentialId?: string;
  duration?: number;
  errorCode?: string;
  code?: string;
  [key: string]: unknown;
}

export type LogLevel = 'silent' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
export type LogFormat = 'text' | 'json';

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

function createPino(level: LogLevel, format: LogFormat): Logger {
  return pino({
    level,
    ...(format === 'text'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  });
}

/**
 * 结构化日志封装。实现 NestJS LoggerService 接口。
 * 严禁记录 password / cookie / authorization / provider secret 等敏感字段。
 *
 * 日志级别：运行时动态切换（Redis pub/sub 驱动的 setLevel()）。
 * 日志格式（text/json）：restartRequired —— 进程启动时从 DB 读取 log.format，
 *   通过 reconfigure() 应用，运行期间不可热切换。
 */
@Injectable()
export class EnovaLogger implements LoggerService {
  private logger: Logger;

  constructor(options?: { level?: LogLevel; format?: LogFormat }) {
    this.logger = createPino(
      options?.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info',
      options?.format ?? (process.env.LOG_FORMAT as LogFormat) ?? 'text',
    );
  }

  /**
   * 启动时从 DB 读取配置后调用，重建内部 Pino 实例。
   * log.format 为 restartRequired，运行期间不调用此方法。
   */
  reconfigure(config: { level: LogLevel; format: LogFormat }): void {
    this.logger = createPino(config.level, config.format);
  }

  /** 运行时动态切换日志级别（无需重启，由 SettingsService 在收到 invalidation 后调用）。 */
  setLevel(level: LogLevel): void {
    this.logger.level = level;
  }

  /** 结构化 info 日志（业务代码使用）。 */
  info(message: string, fields: LogFields = {}): void {
    this.logger.info(fields, message);
  }

  /** 将 NestJS 的 optionalParams（可能是 stack/context）归一化为结构化字段。 */
  private normalize(...optionalParams: unknown[]): LogFields {
    const fields: LogFields = {};
    for (const p of optionalParams) {
      if (typeof p === 'string') {
        if (fields['context'] === undefined) {
          fields['context'] = p.length > 0 ? p : undefined;
        }
      } else if (p && typeof p === 'object') {
        Object.assign(fields, p as LogFields);
      }
    }
    return fields;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(this.normalize(...optionalParams), this.toMessage(message, 'info'));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const fields = this.normalize(...optionalParams);
    if (message instanceof Error) {
      this.logger.error({ err: message, ...fields }, message.message);
    } else {
      this.logger.error(fields, this.toMessage(message, 'error'));
    }
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(this.normalize(...optionalParams), this.toMessage(message, 'warn'));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(this.normalize(...optionalParams), this.toMessage(message, 'debug'));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(this.normalize(...optionalParams), this.toMessage(message, 'trace'));
  }

  fatal(message: unknown, fields: LogFields = {}, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.fatal({ err: error, ...fields }, typeof message === 'string' ? message : 'fatal');
    } else {
      this.logger.fatal(fields, typeof message === 'string' ? message : 'fatal');
    }
  }

  private toMessage(message: unknown, fallback: string): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return fallback;
    }
  }
}