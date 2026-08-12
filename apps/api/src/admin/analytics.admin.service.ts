import { Inject, Injectable } from '@nestjs/common';
import { BusinessAnalytics, type AnalyticsDashboard, type AnalyticsRange } from '@enova/billing';
import type { Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export { AnalyticsDashboard, AnalyticsRange };

/**
 * P1-3: 运营/经营分析（Admin）。
 * 封装 packages/billing 的 BusinessAnalytics 领域服务，提供时间窗看板与 CSV 导出。
 */
@Injectable()
export class AnalyticsAdminService {
  private readonly analytics: BusinessAnalytics;
  constructor(@Inject(DATABASE) db: Database) {
    this.analytics = new BusinessAnalytics(db);
  }

  dashboard(range: AnalyticsRange, opts: { timezone?: string; startAt?: Date; endAt?: Date } = {}): Promise<AnalyticsDashboard> {
    return this.analytics.dashboard(range, opts);
  }

  exportCsv(range: AnalyticsRange, opts: { timezone?: string; startAt?: Date; endAt?: Date } = {}): Promise<string> {
    return this.analytics.toCsv(range, opts);
  }
}