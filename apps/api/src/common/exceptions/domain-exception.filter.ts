import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { HttpServer } from '@nestjs/common/interfaces/http/http-server.interface';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type ApiErrorBody } from '@enova/contracts';
import { EnovaLogger } from '../logger/enova-logger.js';

/**
 * 全局异常过滤器：把 DomainError / 其他异常统一为
 * { "error": { "code", "message", "requestId", "details" } }。
 * 前端只依赖 error.code 分支，不再用字符串判断。
 *
 * 响应发送统一走 httpAdapter.reply()：NestJS 的 Fastify 适配器在
 * middleware 抛错（如 RequestIdMiddleware 链路）时传入的是原生
 * http.ServerResponse（无 .status/.code/.send），与常规路由错误的
 * FastifyReply 不同。adapter 会正确包装/发送两种响应，
 * 避免 `res.status is not a function` 导致进程崩溃。
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: EnovaLogger,
    private readonly httpAdapter?: HttpServer,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const requestId = (req as FastifyRequest & { requestId?: string }).requestId;

    const body: ApiErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId },
    };
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof DomainError) {
      status = exception.statusCode;
      body.error.code = exception.code;
      body.error.message = exception.message;
      if (exception.details !== undefined) body.error.details = exception.details;
      this.logger.info(`request failed: ${exception.code}`, {
        requestId,
        errorCode: exception.code,
        statusCode: status,
      });
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        body.error.message = resp;
      } else if (resp && typeof resp === 'object') {
        const r = resp as { message?: string | string[]; error?: string };
        body.error.message = Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? r.error ?? 'Error');
        if (status === HttpStatus.BAD_REQUEST) {
          body.error.code = 'VALIDATION_ERROR';
          if (Array.isArray(r.message)) body.error.details = r.message;
        }
      }
      this.logger.warn(`request rejected: ${body.error.code}`, {
        requestId,
        errorCode: body.error.code,
        statusCode: status,
      });
    } else {
      // 尽量保留原始错误信息（不含堆栈），便于排查；message 为字符串时
      // EnovaLogger.error 不会自动带上 error，这里显式传入错误对象。
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(`unhandled exception: ${message}`, { requestId }, exception);
    }

    const adapter = this.httpAdapter;
    if (adapter) {
      if (adapter.isHeadersSent(res)) {
        adapter.end(res);
      } else {
        adapter.reply(res, body, status);
      }
      return;
    }

    // 兜底：无 adapter 时直接操作响应对象（FastifyReply 或原生 http 响应）。
    const reply = res as FastifyReply & {
      code?: (c: number) => { send: (b: unknown) => unknown };
      statusCode?: number;
      setHeader?: (k: string, v: string) => void;
      end?: (b: string) => void;
    };
    if (typeof reply.code === 'function') {
      void reply.code(status).send(body);
    } else if (typeof (reply as { status?: (c: number) => unknown }).status === 'function') {
      void (reply as unknown as { status: (c: number) => { send: (b: unknown) => unknown } }).status(status).send(body);
    } else {
      if (reply.statusCode !== undefined) reply.statusCode = status;
      reply.setHeader?.('content-type', 'application/json');
      reply.end?.(JSON.stringify(body));
    }
  }
}
