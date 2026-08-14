import { Injectable, NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SettingsService } from '../../settings/settings.service.js';
import { EnovaLogger } from '../logger/enova-logger.js';

/** 请求级访问日志：开关由 log.accessLog 动态控制，默认开启。 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  constructor(
    private readonly settings: SettingsService,
    private readonly logger: EnovaLogger,
  ) {}

  use(req: FastifyRequest, res: FastifyReply, next: () => void): void {
    const startedAt = Date.now();
    res.raw.once('finish', () => {
      void this.settings.getAccessLog().then((enabled) => {
        if (enabled === false) return;
        this.logger.info('http request completed', {
          requestId: (req as FastifyRequest & { requestId?: string }).requestId,
          method: req.method,
          path: req.url.split('?')[0],
          statusCode: res.raw.statusCode,
          duration: Date.now() - startedAt,
        });
      }).catch(() => {
        // 日志配置读取失败不影响请求完成。
      });
    });
    next();
  }
}
