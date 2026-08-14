import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { AdminAuditService } from '../admin.audit.service.js';
import { SystemUpdateService } from './system-update.service.js';
import { RollbackVersionDto, UpdateVersionDto } from './system-update.dto.js';
import type { OperationView, RollbackVersionView, UpdateInfoView } from './types.js';

@ApiTags('admin/system-update')
@Controller('api/v1/admin/system-update')
@UseGuards(AuthGuard, PermissionGuard)
export class SystemUpdateController {
  constructor(
    @Inject(SystemUpdateService) private readonly service: SystemUpdateService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get('status')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '系统更新状态（当前/最新版本、是否可更新）' })
  status(@Query('force') force?: string): Promise<UpdateInfoView> {
    return this.service.checkStatus(force === 'true');
  }

  @Get('check')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '强制刷新并返回更新信息' })
  check(): Promise<UpdateInfoView> {
    return this.service.checkStatus(true);
  }

  @Get('rollback-versions')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '可回滚/可切换的历史稳定版本列表' })
  rollbackVersions(): Promise<{ versions: RollbackVersionView[] }> {
    return this.service.listRollbackVersions().then((versions) => ({ versions }));
  }

  @Post('update')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '触发后台更新（到最新或指定版本）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body() dto?: UpdateVersionDto,
  ): Promise<OperationView> {
    const operationId = this.buildOperationId('update', user.userId, idempotencyKey);
    const op = await this.service.startUpdate(operationId, dto?.version);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'system.update',
      resourceType: 'system',
      resourceId: operationId,
      after: { version: dto?.version, operation_id: operationId },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return op;
  }

  @Post('rollback')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '触发后台回滚（回退上一个版本，或指定版本）' })
  async rollback(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body() dto?: RollbackVersionDto,
  ): Promise<OperationView> {
    const operationId = this.buildOperationId('rollback', user.userId, idempotencyKey);
    const op = await this.service.startRollback(operationId, dto?.version);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'system.rollback',
      resourceType: 'system',
      resourceId: operationId,
      after: { version: dto?.version, operation_id: operationId },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return op;
  }

  @Get('operations/:operationId')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '查询一次后台更新/回滚操作的实时进度' })
  operation(@Param('operationId') operationId: string): Promise<OperationView> {
    return this.service.getOperation(operationId);
  }

  private buildOperationId(operation: string, userId: string, idempotencyKey?: string): string {
    if (idempotencyKey && idempotencyKey.trim()) {
      const seed = `${operation}|${userId}|${idempotencyKey.trim()}`;
      return `sysop-${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
    }
    return `sysop-${operation}-${randomUUID()}`;
  }
}
