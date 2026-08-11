import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import type { Database } from '@enova/db';

@ApiTags('health')
@Controller('api/v1')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('health')
  @ApiOperation({ summary: '存活探针（不依赖外部依赖）' })
  liveness(): { status: string; service: string } {
    return { status: 'ok', service: 'enova-api' };
  }

  @Get('health/ready')
  @ApiOperation({ summary: '就绪探针（校验与 PostgreSQL 连通性）' })
  async readiness(): Promise<{ status: string; database: string }> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}