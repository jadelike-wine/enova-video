import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RbacStore } from '@enova/billing';
import { ERROR_CODES, PERMISSIONS, domainError, type AdminRole } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('admin-rbac')
@Controller('api/v1/admin/rbac')
@UseGuards(AuthGuard, PermissionGuard)
export class RbacAdminController {
  constructor(
    @Inject(RbacStore) private readonly rbac: RbacStore,
  ) {}

  @Get('roles')
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: '列出所有角色' })
  async listRoles() {
    return this.rbac.listRoles();
  }

  @Get('users/:userId/roles')
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: '查看用户角色' })
  async getUserRoles(@Param('userId') userId: string) {
    return { roles: await this.rbac.rolesForUser(userId) };
  }

  @Post('users/:userId/roles')
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: '分配角色' })
  async assignRole(
    @Param('userId') targetUserId: string,
    @Body() body: { role: AdminRole; reason?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    await this.rbac.assignRole(targetUserId, body.role, actor.userId);
    return { ok: true };
  }

  @Delete('users/:userId/roles/:role')
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: '撤销角色' })
  async removeRole(
    @Param('userId') targetUserId: string,
    @Param('role') role: AdminRole,
    @CurrentUser() actor: AuthUser,
  ) {
    // Self-lockout protection: don't remove own SUPER_ADMIN
    if (targetUserId === actor.userId && role === 'SUPER_ADMIN') {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Cannot remove your own SUPER_ADMIN role', 403);
    }
    await this.rbac.removeRole(targetUserId, role);
    return { ok: true };
  }
}
