import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { domainError, ERROR_CODES, USER_ROLES } from '@enova/contracts';
import type { AuthUser } from '../auth/auth.service.js';

/**
 * 管理员守卫：校验当前用户 role === ADMIN。
 * 必须与 AuthGuard 组合使用（@UseGuards(AuthGuard, AdminGuard)），
 * 因为它依赖 AuthGuard 解析出的 req.authUser。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & { authUser?: AuthUser }>();
    const user = req.authUser;
    if (!user || user.role !== USER_ROLES.ADMIN) {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Admin access required', 403);
    }
    return true;
  }
}