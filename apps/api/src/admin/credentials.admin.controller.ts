import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  CredentialsAdminService,
  type CredentialView,
} from './credentials.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { SensitiveActionService } from '../common/services/sensitive-action.service.js';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/admin.dto.js';

@ApiTags('admin/credentials')
@Controller('api/v1/admin')
@UseGuards(AuthGuard, PermissionGuard)
export class CredentialsAdminController {
  constructor(
    @Inject(CredentialsAdminService) private readonly service: CredentialsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(SensitiveActionService) private readonly sensitiveAction: SensitiveActionService,
  ) {}

  @Get('providers/:providerId/credentials')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '列出指定 Provider 的 Credential（不含 Secret 明文）' })
  listByProvider(@Param('providerId', ParseUUIDPipe) providerId: string): Promise<CredentialView[]> {
    return this.service.listByProvider(providerId);
  }

  @Post('providers/:providerId/credentials')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '创建 Credential（Secret 加密入库）' })
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CredentialView> {
    // P1.5: Sensitive action gate (step-up + audit) before creating a credential.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.CREDENTIALS_ROTATE,
      target: `provider:${providerId}`,
      reason: 'Create provider credential',
      requestId: req.id,
      stepUpPassword,
    });
    const view = await this.service.create(providerId, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.create',
      resourceType: 'credential',
      resourceId: view.id,
      after: view as unknown as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Patch('credentials/:id')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '更新 Credential（仅传新 secret 时重新加密）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDto,
  ): Promise<CredentialView> {
    const before = await this.service.get(id);
    // P1.5: Sensitive action gate (step-up + audit) before rotating a credential.
    // sensitive_action_logs 只记脱敏标识；完整 before/after 由 admin_audit_logs 落库。
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.CREDENTIALS_ROTATE,
      target: `credential:${id}`,
      reason: 'Update provider credential',
      before: { credentialId: id },
      requestId: req.id,
      stepUpPassword,
    });
    const view = await this.service.update(id, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.update',
      resourceType: 'credential',
      resourceId: id,
      before: before ? (before as unknown as Record<string, unknown>) : undefined,
      after: view as unknown as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Delete('credentials/:id')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '删除 Credential' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    const before = await this.service.get(id);
    // P1.5: Sensitive action gate (step-up + audit) before deleting a credential.
    // sensitive_action_logs 只记脱敏标识；完整 before 由 admin_audit_logs 落库。
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.CREDENTIALS_ROTATE,
      target: `credential:${id}`,
      reason: 'Delete provider credential',
      before: { credentialId: id },
      requestId: req.id,
      stepUpPassword,
    });
    await this.service.remove(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.delete',
      resourceType: 'credential',
      resourceId: id,
      before: before ? (before as unknown as Record<string, unknown>) : undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true };
  }
}
