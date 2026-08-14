import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import IORedis from 'ioredis';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { OpsMonitoringService, type OpsMetrics } from './ops-monitoring.service.js';
import { RATE_LIMIT_REDIS } from '../common/guards/rate-limit.guard.js';

/**
 * P0-7: Ops Monitoring Controller.
 *
 * Provides operational metrics for the admin ops dashboard.
 * All endpoints require OPS_READ permission.
 */
@ApiTags('admin/ops')
@Controller('api/v1/admin/ops')
@UseGuards(AuthGuard, PermissionGuard)
export class OpsMonitoringController {
  constructor(
    @Inject(OpsMonitoringService) private readonly monitoring: OpsMonitoringService,
    @Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis,
  ) {}

  @Get('metrics')
  @RequirePermission(PERMISSIONS.OPS_READ)
  @ApiOperation({ summary: '获取运营监控指标（DB/Redis/队列/支付/生成/告警）' })
  async getMetrics(): Promise<OpsMetrics> {
    return this.monitoring.getMetrics(this.redis);
  }

  @Get('alerts')
  @RequirePermission(PERMISSIONS.OPS_READ)
  @ApiOperation({ summary: '获取当前告警列表' })
  async getAlerts(): Promise<{ alerts: OpsMetrics['alerts']; timestamp: string }> {
    const metrics = await this.monitoring.getMetrics(this.redis);
    return { alerts: metrics.alerts, timestamp: metrics.timestamp };
  }

  @Get('health')
  @RequirePermission(PERMISSIONS.OPS_READ)
  @ApiOperation({ summary: '获取系统健康状态（DB + Redis）' })
  async getHealth(): Promise<{
    database: { status: string; latencyMs: number };
    redis: { status: string; latencyMs: number };
    timestamp: string;
  }> {
    const metrics = await this.monitoring.getMetrics(this.redis);
    return {
      database: metrics.database,
      redis: metrics.redis,
      timestamp: metrics.timestamp,
    };
  }
}
