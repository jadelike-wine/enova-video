import { Injectable, LoggerService } from '@nestjs/common';
import pino, { type Logger, type LoggerOptions } from 'pino';

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

/**
 * 结构化日志封装。所有日志都以 JSON 结构输出，便于在 ELK / Loki 中检索。
 * 实现 NestJS LoggerService 接口，同时保留结构化字段方法供业务代码使用。
 * 严禁记录 password / cookie / authorization / provider secret 等敏感字段。
 */
@Injectable()
export class EnovaLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(options?: LoggerOptions) {
    this.logger = pino(
      options ?? {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: [
            'password',
            '*.password',
            'cookie',
            '*.cookie',
            'authorization',
            '*.authorization',
            'secret',
            '*.secret',
            '*Secret',
            'apiKey',
            '*.apiKey',
          ],
          censor: '[REDACTED]',
        },
      },
    );
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