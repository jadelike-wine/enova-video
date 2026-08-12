import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { StatsAdminService, type AdminStatsView } from './stats.admin.service.js';

@ApiTags('admin/stats')
@Controller('api/v1/admin/stats')
@UseGuards(AuthGuard, PermissionGuard)
export class StatsAdminController {
  constructor(@Inject(StatsAdminService) private readonly service: StatsAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: '全局统计：用户/工作区/任务规模与余额总量' })
  summary(): Promise<AdminStatsView> {
    return this.service.summary();
  }
}
