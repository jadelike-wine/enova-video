import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * 为每个请求生成 / 接受 X-Request-ID，并写入响应头与本地上下文。
 * 上层日志、错误信息、Job 均可通过 requestId 关联。
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void): void {
    const existing = req.headers['x-request-id'];
    const requestId = Array.isArray(existing) ? existing[0] : existing ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    // Fastify reply 用 .header()，原始 http 响应用 .setHeader()，两者兼容。
    if (typeof res.header === 'function') {
      res.header('x-request-id', requestId);
    } else {
      (res as { setHeader?: (k: string, v: string) => void }).setHeader?.('x-request-id', requestId);
    }
    (req as FastifyRequest & { requestId?: string }).requestId = requestId;
    next();
  }
}