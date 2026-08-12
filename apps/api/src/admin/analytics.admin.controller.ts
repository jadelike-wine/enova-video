import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import {
  AnalyticsAdminService,
  type AnalyticsDashboard,
  type AnalyticsRange,
} from './analytics.admin.service.js';

@ApiTags('admin/analytics')
@Controller('api/v1/admin/analytics')
@UseGuards(AuthGuard, PermissionGuard)
export class AnalyticsAdminController {
  constructor(@Inject(AnalyticsAdminService) private readonly service: AnalyticsAdminService) {}

  @Get('dashboard')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: '经营看板：Revenue/COGS/Margin/Jobs/Users/SuccessRate/Provider·Model·Cost-Status' })
  dashboard(
    @Query('range') range: AnalyticsRange = '7d',
    @Query('timezone') timezone?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
  ): Promise<AnalyticsDashboard> {
    return this.service.dashboard(range, {
      timezone,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
    });
  }

  @Get('export.csv')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: '看板 CSV 导出（基础能力）' })
  async exportCsv(
    @Res() res: FastifyReply,
    @Query('range') range: AnalyticsRange = '7d',
    @Query('timezone') timezone?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
  ): Promise<void> {
    const csv = await this.service.exportCsv(range, {
      timezone,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
    });
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="analytics.csv"');
    res.send(csv);
  }
}
