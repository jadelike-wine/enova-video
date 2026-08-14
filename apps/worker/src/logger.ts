import pino, { type Logger } from 'pino';

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

export type WorkerLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
export type WorkerLogFormat = 'text' | 'json';

const REDACT_PATHS = [
  'password', '*.password',
  'cookie', '*.cookie',
  'authorization', '*.authorization',
  'secret', '*.secret', '*Secret',
  'apiKey', '*.apiKey',
];

function createPino(name: string, level: WorkerLogLevel, format: WorkerLogFormat): Logger {
  return pino({
    name,
    level,
    ...(format === 'text'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  });
}

/**
 * Worker 结构化日志。严禁记录 password / cookie / authorization / provider secret 等敏感字段。
 *
 * 日志级别：运行时动态切换（Redis pub/sub 驱动的 setLevel()）。
 * 日志格式（text/json）也可由 WorkerSettings 在运行时重建 logger 后生效。
 */
export class WorkerLogger {
  private logger: Logger;
  private readonly name: string;

  constructor(name: string, options?: { level?: WorkerLogLevel; format?: WorkerLogFormat }) {
    this.name = name;
    this.logger = createPino(
      name,
      options?.level ?? 'info',
      options?.format ?? 'text',
    );
  }

  /**
   * 启动时从 DB 读取配置后调用，重建内部 Pino 实例。
   * 由 WorkerSettings 在启动和配置失效通知时调用。
   */
  reconfigure(config: { level: WorkerLogLevel; format: WorkerLogFormat }): void {
    this.logger = createPino(this.name, config.level, config.format);
  }

  /** 运行时动态切换日志级别（无需重启）。 */
  setLevel(level: WorkerLogLevel): void {
    this.logger.level = level;
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
