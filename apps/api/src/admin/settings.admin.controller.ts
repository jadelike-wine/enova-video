import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
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
import { SettingsAdminService } from './settings.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { SensitiveActionService } from '../common/services/sensitive-action.service.js';
import { UpdateSettingDto } from './dto/admin.dto.js';
import type { SettingValueView } from '../settings/settings.service.js';

@ApiTags('admin/settings')
@Controller('api/v1/admin/settings')
@UseGuards(AuthGuard, PermissionGuard)
export class SettingsAdminController {
  constructor(
    @Inject(SettingsAdminService) private readonly service: SettingsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(SensitiveActionService) private readonly sensitiveAction: SensitiveActionService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '列出全部动态配置（敏感值脱敏）' })
  list(): Promise<SettingValueView[]> {
    return this.service.list();
  }

  @Patch(':key')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '更新单个动态配置（实时生效）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ): Promise<SettingValueView> {
    // P1.5: Sensitive action gate (step-up + audit) before mutating dynamic config.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.SETTINGS_WRITE,
      target: `setting:${key}`,
      reason: `Update setting: ${key}`,
      requestId: req.id,
      stepUpPassword,
    });
    const view = await this.service.update(key, dto.value);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'settings.update',
      resourceType: 'setting',
      resourceId: key,
      after: { value: dto.value },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }
}
