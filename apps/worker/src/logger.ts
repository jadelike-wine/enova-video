import pino, { type Logger, type LoggerOptions } from 'pino';

export interface WorkerLogFields {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  generationJobId?: string;
  provider?: string;
  providerCredentialId?: string;
  duration?: number;
  errorCode?: string;
  [key: string]: unknown;
}

/**
 * Worker 结构化日志。所有日志 JSON 化，便于关联 request/job/provider。
 * 严禁记录 password / cookie / authorization / provider secret 等敏感字段。
 */
export class WorkerLogger {
  private readonly logger: Logger;

  constructor(name: string, options?: LoggerOptions) {
    this.logger = pino(
      options ?? {
        name,
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

  debug(message: string, fields: WorkerLogFields = {}): void {
    this.logger.debug(fields, message);
  }

  info(message: string, fields: WorkerLogFields = {}): void {
    this.logger.info(fields, message);
  }

  warn(message: string, fields: WorkerLogFields = {}): void {
    this.logger.warn(fields, message);
  }

  error(message: string, fields: WorkerLogFields = {}, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.error({ err: error, ...fields }, message);
    } else {
      this.logger.error(fields, message);
    }
  }

  fatal(message: string, fields: WorkerLogFields = {}, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.fatal({ err: error, ...fields }, message);
    } else {
      this.logger.fatal(fields, message);
    }
  }
}