import { Inject, Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import {
  generationJobs,
  users,
  walletLedger,
  wallets,
  workspaces,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface AdminStatsView {
  users: number;
  workspaces: number;
  generations: number;
  generationsByStatus: Record<string, number>;
  generationsByType: Record<string, number>;
  totalBalance: number;
  totalReservedBalance: number;
  totalCreditsSpent: number;
}

/**
 * Dashboard 统计（Admin）：用户/工作区/任务规模与余额总量。
 * 仅只读聚合，不暴露任何 Provider Secret。
 */
@Injectable()
export class StatsAdminService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async summary(): Promise<AdminStatsView> {
    const [userCount] = await this.db.select({ n: count() }).from(users);
    const [wsCount] = await this.db.select({ n: count() }).from(workspaces);
    const [genCount] = await this.db.select({ n: count() }).from(generationJobs);

    const byStatus = await this.db
      .select({ status: generationJobs.status, n: count() })
      .from(generationJobs)
      .groupBy(generationJobs.status);
    const byType = await this.db
      .select({ type: generationJobs.type, n: count() })
      .from(generationJobs)
      .groupBy(generationJobs.type);

    const [walletAgg] = await this.db
      .select({
        balance: sql<number>`coalesce(sum(${wallets.balance}), 0)`,
        reserved: sql<number>`coalesce(sum(${wallets.reservedBalance}), 0)`,
      })
      .from(wallets);

    const [spentAgg] = await this.db
      .select({ n: sql<number>`coalesce(sum(${walletLedger.amount}), 0)` })
      .from(walletLedger)
      .where(eq(walletLedger.type, 'GENERATION_SETTLE'));

    return {
      users: userCount.n,
      workspaces: wsCount.n,
      generations: genCount.n,
      generationsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
      generationsByType: Object.fromEntries(byType.map((r) => [r.type, r.n])),
      totalBalance: walletAgg.balance,
      totalReservedBalance: walletAgg.reserved,
      totalCreditsSpent: spentAgg.n,
    };
  }
}