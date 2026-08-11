import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type ApiErrorBody } from '@enova/contracts';
import { EnovaLogger } from '../logger/enova-logger.js';

/**
 * 全局异常过滤器：把 DomainError / 其他异常统一为
 * { "error": { "code", "message", "requestId", "details" } }。
 * 前端只依赖 error.code 分支，不再用字符串判断。
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: EnovaLogger) {}

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
      this.logger.error('unhandled exception', { requestId }, exception);
    }

    void res.status(status).send(body);
  }
}