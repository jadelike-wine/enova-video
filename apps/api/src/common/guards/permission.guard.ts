import { CanActivate, ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { domainError, ERROR_CODES, type Permission } from '@enova/contracts';
import { RbacStore } from '@enova/billing';
import type { AuthUser } from '../../auth/auth.service.js';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator.js';

/**
 * Permission-based guard (P1.5).
 *
 * RBAC default deny: only @RequirePermission-decorated endpoints are accessible,
 * and only if the user has the required permission via RBAC role assignments.
 *
 * Legacy role='ADMIN' is no longer an authorization path — all admins must
 * have proper RBAC role assignments (seeded by AdminBootstrapService on startup).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RbacStore) private readonly rbac: RbacStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { authUser?: AuthUser }>();
    const user = req.authUser;
    if (!user) {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Authentication required', 401);
    }

    const requiredPermission = this.reflector.getAllAndOverride<Permission>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermission) {
      // No @RequirePermission → default deny
      throw domainError(ERROR_CODES.FORBIDDEN, 'Access denied: insufficient permissions', 403);
    }

    const hasPermission = await this.rbac.hasPermission(user.userId, requiredPermission);
    if (!hasPermission) {
      throw domainError(ERROR_CODES.FORBIDDEN, `Permission denied: ${requiredPermission}`, 403);
    }

    return true;
  }
}
