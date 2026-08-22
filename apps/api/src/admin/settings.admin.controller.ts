import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS } from '@enova/contracts';
import { SETTINGS_BY_KEY } from '@enova/db';
import { RbacStore } from '@enova/billing';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { SettingsAdminService } from './settings.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import {
  UpdateSettingDto,
  BatchUpdateSettingsDto,
} from './dto/admin.dto.js';
import type { Permission } from '@enova/contracts';
import type { SettingValueView } from '../settings/settings.service.js';

@ApiTags('admin/settings')
@Controller('api/v1/admin/settings')
@UseGuards(AuthGuard, PermissionGuard)
export class SettingsAdminController {
  constructor(
    @Inject(SettingsAdminService) private readonly service: SettingsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(RbacStore) private readonly rbac: RbacStore,
  ) {}

  /**
   * 运行时检查 per-setting 权限：安全配置（如 SSRF）需要 SETTINGS_SECURITY_WRITE，
   * 高于基础 SETTINGS_WRITE。PermissionGuard 只做 endpoint 级别检查，这里做 setting 级别检查。
   */
  private async checkSettingPermission(userId: string, key: string): Promise<void> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def?.permission) return; // 无特殊权限要求 → 基础 SETTINGS_WRITE 已足够
    const hasPermission = await this.rbac.hasPermission(userId, def.permission as Permission);
    if (!hasPermission) {
      throw new Error(`Permission denied: ${def.permission} required for setting ${key}`);
    }
  }

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '列出全部动态配置（敏感值脱敏）' })
  list(): Promise<SettingValueView[]> {
    return this.service.list();
  }

  @Post('storage/test')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '测试对象存储配置（上传、检查 URL、清理测试对象）' })
  testStorage() {
    return this.service.testStorage();
  }

  @Patch(':key')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '更新单个动态配置（CAS + history + 实时生效）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ): Promise<SettingValueView> {
    await this.checkSettingPermission(user.userId, key);
    const view = await this.service.update(key, dto.value, {
      expectedVersion: dto.expectedVersion,
      updatedBy: user.userId,
      requestId: req.id,
      reason: `Update setting: ${key}`,
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'settings.update',
      resourceType: 'setting',
      resourceId: key,
      after: { value: dto.value ? '[REDACTED]' : '(empty)' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Post('batch')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '批量原子更新配置（同组一致性，Secret 留空=保持不变）' })
  async batchUpdate(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: BatchUpdateSettingsDto,
  ): Promise<SettingValueView[]> {
    // 检查所有 key 的 per-setting 权限（安全配置需要更高权限）。
    for (const item of dto.items) {
      await this.checkSettingPermission(user.userId, item.key);
    }
    const keys = dto.items.map((i) => i.key).join(', ');
    const views = await this.service.updateGroup(
      dto.items.map((i) => ({ key: i.key, value: i.value })),
      {
        updatedBy: user.userId,
        requestId: req.id,
        reason: `Batch update: ${keys}`,
      },
    );
    await this.audit.record({
      actorUserId: user.userId,
      action: 'settings.batch_update',
      resourceType: 'setting',
      resourceId: keys,
      after: { count: dto.items.length },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return views;
  }

  @Delete(':key/secret')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '清除 Secret 配置' })
  async clearSecret(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('key') key: string,
  ): Promise<SettingValueView> {
    await this.checkSettingPermission(user.userId, key);
    const view = await this.service.clearSecret(key, {
      updatedBy: user.userId,
      requestId: req.id,
      reason: `Clear secret: ${key}`,
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'settings.clear_secret',
      resourceType: 'setting',
      resourceId: key,
      after: { cleared: true },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Get(':key/history')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '查看配置变更历史（Secret 脱敏）' })
  async history(
    @Param('key') key: string,
    @Query('limit') limit?: number,
  ) {
    return this.service.history(key, limit ? Math.min(Math.max(limit, 1), 200) : 50);
  }
}
