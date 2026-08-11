import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { StatsAdminService, type AdminStatsView } from './stats.admin.service.js';

@ApiTags('admin/stats')
@Controller('api/v1/admin/stats')
@UseGuards(AuthGuard, AdminGuard)
export class StatsAdminController {
  constructor(@Inject(StatsAdminService) private readonly service: StatsAdminService) {}

  @Get()
  @ApiOperation({ summary: '全局统计：用户/工作区/任务规模与余额总量' })
  summary(): Promise<AdminStatsView> {
    return this.service.summary();
  }
}