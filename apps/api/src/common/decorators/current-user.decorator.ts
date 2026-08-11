import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.service.js';

/**
 * 从经 AuthGuard 解析的请求上下文取当前用户。
 * 用法：@CurrentUser() user: AuthUser
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ authUser?: AuthUser }>();
    return req.authUser!;
  },
);

export type { AuthUser };