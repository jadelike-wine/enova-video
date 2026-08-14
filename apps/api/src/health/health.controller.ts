import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import type { FastifyReply } from 'fastify';
import { DATABASE } from '../database/database.module.js';
import type { Database } from '@enova/db';
import { RATE_LIMIT_REDIS } from '../common/guards/rate-limit.guard.js';

@ApiTags('health')
@Controller('api/v1')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Optional() @Inject(RATE_LIMIT_REDIS) private readonly redis?: IORedis,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '存活探针（不依赖外部依赖）' })
  liveness(): { status: string; service: string; version: string } {
    return {
      status: 'ok',
      service: 'enova-api',
      version: process.env.APP_VERSION || 'unknown',
    };
  }

  @Get('health/ready')
  @ApiOperation({ summary: '就绪探针（校验 PostgreSQL + Redis 连通性，不可用时返回 503）' })
  async readiness(
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{
    status: string;
    database: string;
    redis: string;
    checks: Record<string, { status: string; latencyMs: number }>;
  }> {
    const checks: Record<string, { status: string; latencyMs: number }> = {};

    // Database check
    const dbStart = Date.now();
    let dbStatus = 'up';
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'down';
    }
    checks.database = { status: dbStatus, latencyMs: Date.now() - dbStart };

    // Redis check
    const redisStart = Date.now();
    let redisStatus = 'up';
    if (this.redis) {
      try {
        await this.redis.ping();
      } catch {
        redisStatus = 'down';
      }
    } else {
      redisStatus = 'not-configured';
    }
    checks.redis = { status: redisStatus, latencyMs: Date.now() - redisStart };

    const overall = dbStatus === 'up' && redisStatus === 'up' ? 'ok' : 'degraded';

    // Return 503 when dependencies are not ready.
    if (overall !== 'ok') {
      res.status(503);
    }

    return {
      status: overall,
      database: dbStatus,
      redis: redisStatus,
      checks,
    };
  }
}
