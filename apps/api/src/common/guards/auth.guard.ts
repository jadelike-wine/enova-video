import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { AuthService, type AuthUser } from '../../auth/auth.service.js';
import { SESSION_COOKIE } from '../../auth/session.service.js';
import { parseCookie } from '../http/cookies.js';

/**
 * 会话守卫：从 HttpOnly Cookie 读取 session token，解析当前用户并挂到请求上。
 * 同时校验用户 Personal Workspace 存在，作为后续 workspace 隔离的上下文来源。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      FastifyRequest & { authUser?: AuthUser; requestId?: string }
    >();

    const rawToken = this.readToken(req);
    if (!rawToken) {
      throw domainError(ERROR_CODES.UNAUTHORIZED, 'Authentication required', 401);
    }

    const user = await this.auth.resolveSession(this.auth.mustHashToken(rawToken));
    if (!user) {
      throw domainError(ERROR_CODES.SESSION_EXPIRED, 'Session invalid or expired', 401);
    }

    req.authUser = user;
    return true;
  }

  private readToken(req: FastifyRequest): string | undefined {
    return parseCookie(req.headers.cookie as string | undefined, SESSION_COOKIE);
  }
}